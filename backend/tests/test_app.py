import asyncio
import io
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

TEST_DATA = tempfile.TemporaryDirectory()
os.environ["DATA_DIR"] = TEST_DATA.name
from backend import app as module
from fastapi.testclient import TestClient
from docx import Document
from openpyxl import Workbook
import httpx


class DocumentTests(unittest.TestCase):
    def test_html_extracts_body_tables_without_scripts(self):
        source = '<html><head><style>.x{color:red}</style></head><body><h1>季度报告</h1><p>收入 240 万</p><script>alert("do not run")</script><table><tr><td>增长率</td><td>20%</td></tr></table></body></html>'
        text = module.extract_text("report.html", source.encode())
        self.assertIn("季度报告", text)
        self.assertIn("增长率", text)
        self.assertIn("20%", text)
        self.assertNotIn("alert", text)
        self.assertNotIn("color:red", text)

    def test_chinese_encodings_and_empty_documents(self):
        self.assertEqual(module.extract_text("a.txt", "中文内容".encode("gb18030")), "中文内容")
        self.assertEqual(module.extract_text("a.txt", "中文内容".encode("utf-16")), "中文内容")
        with self.assertRaises(ValueError):
            module.extract_text("empty.html", b"<script>hidden()</script>")
        with self.assertRaises(ValueError):
            module.extract_text("legacy.doc", b"legacy")

    def test_docx_keeps_table_in_body_order(self):
        doc = Document()
        doc.add_paragraph("之前")
        doc.add_table(rows=1, cols=1).cell(0, 0).text = "表格数据"
        doc.add_paragraph("之后")
        out = io.BytesIO()
        doc.save(out)
        text = module.extract_text("a.docx", out.getvalue())
        self.assertLess(text.index("之前"), text.index("表格数据"))
        self.assertLess(text.index("表格数据"), text.index("之后"))

    def test_spreadsheet_preserves_sheets_and_cells(self):
        book = Workbook()
        book.active.title = "一季度"
        book.active.append(["收入", 120])
        book.create_sheet("二季度").append(["收入", 240])
        out = io.BytesIO()
        book.save(out)
        text = module.extract_text("a.xlsx", out.getvalue())
        self.assertIn("【工作表：二季度】", text)
        self.assertIn("收入 | 240", text)


class DiscussionTests(unittest.TestCase):
    def setUp(self):
        module.DEFAULT_KEY = "fake-not-persisted-secret"
        module.KEYS.clear()
        self.client_context = TestClient(module.app)
        self.client = self.client_context.__enter__()
        response = self.client.post("/api/documents", files={"file": ("test.html", "<h1>证据</h1><p>100 增至 120，增长 30%</p>".encode(), "text/html")})
        self.did = response.json()["id"]
        self.agents = module.DEFAULT_AGENTS[:2]
        self.body = {"title": "测试研讨", "goal": "核验增长率", "agents": self.agents, "rounds": 2, "document_ids": [self.did]}

    def tearDown(self):
        self.client_context.__exit__(None, None, None)

    def wait_terminal(self, sid):
        for _ in range(150):
            result = self.client.get(f"/api/sessions/{sid}").json()
            if result["status"] in module.TERMINAL:
                return result
            time.sleep(0.01)
        self.fail("Discussion did not finish in time")

    def test_agents_respond_to_previous_turns_and_export_citations(self):
        calls = []
        async def fake(agent, key, messages, thinking, on_delta):
            if calls:
                self.assertIn(f"第{len(calls)}次观点", messages[1]["content"])
            self.assertIn("L1: 证据", messages[1]["content"])
            self.assertEqual(key, "fake-not-persisted-secret")
            calls.append(agent["id"])
            full = f"第{len(calls)}次观点：增幅 20%。[D1:L2]"
            await on_delta(full[:5], full[:5])
            await on_delta(full[5:], full)
            return 100, "stop"
        with patch.object(module, "stream_completion", fake):
            result = self.client.post("/api/sessions", json=self.body)
            self.assertEqual(result.status_code, 201)
            sid = result.json()["id"]
            s = self.wait_terminal(sid)
        self.assertEqual(s["status"], "completed")
        self.assertEqual(calls, ["analyst", "critic", "analyst", "critic", "critic"])
        self.assertEqual(len(s["messages"]), 5)
        self.assertEqual(s["tokens"], 500)
        self.assertEqual(s["messages"][-1]["kind"], "summary")
        export = self.client.get(f"/api/sessions/{sid}/export").text
        self.assertIn("L2: 100 增至 120", export)
        self.assertIn("[D1:L2]", export)
        self.assertNotIn("fake-not-persisted-secret", export)
        self.assertNotIn("fake-not-persisted-secret", json.dumps(s))
        events = self.client.get(f"/api/sessions/{sid}/events?after={s['cursor']}").text
        self.assertNotIn('"type": "delta"', events)
        self.assertIn("event: end", events)

    def test_failure_preserves_final_partial_chunk(self):
        async def fake(agent, key, messages, thinking, on_delta):
            await on_delta("已经收到的内容", "已经收到的内容")
            raise RuntimeError("模拟断流")
        with patch.object(module, "stream_completion", fake):
            sid = self.client.post("/api/sessions", json=self.body).json()["id"]
            s = self.wait_terminal(sid)
        self.assertEqual(s["status"], "failed")
        self.assertEqual(s["messages"][0]["status"], "interrupted")
        self.assertEqual(s["messages"][0]["content"], "已经收到的内容")

    def test_stop_cancels_upstream_and_retains_text(self):
        async def fake(agent, key, messages, thinking, on_delta):
            await on_delta("停止前的发言", "停止前的发言")
            await asyncio.sleep(30)
        with patch.object(module, "stream_completion", fake):
            sid = self.client.post("/api/sessions", json=self.body).json()["id"]
            for _ in range(100):
                if self.client.get(f"/api/sessions/{sid}").json()["messages"]:
                    break
                time.sleep(.01)
            second = self.client.post("/api/sessions", json=self.body)
            self.assertEqual(second.status_code, 409)
            s = self.client.post(f"/api/sessions/{sid}/stop").json()
        self.assertEqual(s["status"], "stopped")
        self.assertEqual(s["messages"][0]["content"], "停止前的发言")
        self.assertNotIn(sid, module.TASKS)

    def test_missing_key_duplicate_agent_and_origin_are_rejected(self):
        module.DEFAULT_KEY = ""
        self.assertEqual(self.client.post("/api/sessions", json=self.body).status_code, 400)
        body = {**self.body, "agents": [self.agents[0], self.agents[0]]}
        self.assertEqual(self.client.post("/api/sessions", json=body).status_code, 422)
        r = self.client.post("/api/settings", json={"shared_key": "test"}, headers={"Origin": "https://untrusted.example"})
        self.assertEqual(r.status_code, 403)

    def test_refresh_snapshot_never_advances_cursor_beyond_saved_text(self):
        async def fake(agent, key, messages, thinking, on_delta):
            await on_delta("第一片段", "第一片段")
            await on_delta("第二片段", "第一片段第二片段")
            await asyncio.sleep(30)
        with patch.object(module, "stream_completion", fake):
            sid = self.client.post("/api/sessions", json=self.body).json()["id"]
            for _ in range(100):
                s = self.client.get(f"/api/sessions/{sid}").json()
                if s["messages"] and s["messages"][0]["content"].endswith("第二片段"):
                    break
                time.sleep(.01)
            with module.db() as c:
                deltas = [json.loads(r[0]) for r in c.execute("SELECT payload FROM events WHERE session_id=? AND seq<=?", (sid, s["cursor"]))]
            received = "".join(p["text"] for p in deltas if p["type"] == "delta")
            self.assertEqual(s["messages"][0]["content"], received)
            self.assertEqual(received, "第一片段第二片段")
            self.client.post(f"/api/sessions/{sid}/stop")

    def test_independent_keys_and_public_bootstrap(self):
        self.client.post("/api/settings", json={"shared_key": "shared-secret", "agent_keys": {"analyst": "independent-secret"}})
        bootstrap = self.client.get("/api/bootstrap").json()
        self.assertTrue(bootstrap["keys"]["shared"])
        self.assertTrue(bootstrap["keys"]["agents"]["analyst"])
        self.assertNotIn("independent-secret", json.dumps(bootstrap))
        self.assertNotIn("shared-secret", json.dumps(bootstrap))


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_sse_parser_handles_usage_and_utf8(self):
        events = [
            {"choices": [{"delta": {"content": "观点"}, "finish_reason": None}]},
            {"choices": [{"delta": {"content": "成立"}, "finish_reason": "stop"}], "usage": {"total_tokens": 42}},
        ]
        wire = "\n\n".join("data: " + json.dumps(e, ensure_ascii=False) for e in events) + "\n\ndata: [DONE]\n\n"
        real_client = httpx.AsyncClient
        transport = httpx.MockTransport(lambda req: httpx.Response(200, text=wire))
        outputs = []
        async def on_delta(delta, full):
            outputs.append(full)
        with patch.object(module.httpx, "AsyncClient", lambda **kw: real_client(transport=transport)):
            tokens, finish = await module.stream_completion(module.DEFAULT_AGENTS[0], "fake", [], False, on_delta)
        self.assertEqual(outputs[-1], "观点成立")
        self.assertEqual((tokens, finish), (42, "stop"))

    async def test_dropped_stream_is_not_reported_as_success(self):
        real_client = httpx.AsyncClient
        transport = httpx.MockTransport(lambda req: httpx.Response(200, text='data: {"choices":[{"delta":{"content":"部分"}}]}\n\n'))
        async def ignore(delta, full):
            pass
        with patch.object(module.httpx, "AsyncClient", lambda **kw: real_client(transport=transport)):
            with self.assertRaisesRegex(RuntimeError, "中断"):
                await module.stream_completion(module.DEFAULT_AGENTS[0], "fake", [], False, ignore)


if __name__ == "__main__":
    unittest.main()
