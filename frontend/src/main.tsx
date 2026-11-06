import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Minus,
  X,
  FileText,
  Upload,
  Settings2,
  MessageSquare,
  Clock3,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  CheckCheck,
  Loader2,
  Download,
  Square,
  Trash2,
  Eye,
  EyeOff,
  KeyRound,
  Sparkles,
  Layers3,
  PanelRightClose,
  PanelRightOpen,
  CircleHelp,
  Search,
  Copy,
  AlertCircle,
  BookOpen,
  ExternalLink,
  RotateCcw,
  CheckCircle2,
} from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import "./style.css";

type Agent = {
  id: string;
  name: string;
  role: string;
  prompt: string;
  model: string;
  color: string;
};
type Doc = {
  id: string;
  name: string;
  size: number;
  chars: number;
  created: number;
  content?: string;
};
type Msg = {
  id: string;
  agent_id: string;
  agent_name: string;
  color: string;
  round: number;
  kind: string;
  content: string;
  status: string;
  created: number;
};
type Session = {
  id: string;
  title: string;
  goal: string;
  rounds: number;
  agents: Agent[];
  document_ids: string[];
  status: string;
  created: number;
  tokens: number;
  messages: Msg[];
  cursor: number;
};
type SessionHead = Pick<
  Session,
  "id" | "title" | "status" | "created" | "rounds" | "tokens"
>;
type KeyState = { shared: boolean; agents: Record<string, boolean> };
const colors = [
  "blue",
  "amber",
  "green",
  "purple",
  "rose",
  "cyan",
  "slate",
  "orange",
];
const statusText: Record<string, string> = {
  running: "研讨中",
  completed: "已完成",
  stopped: "已停止",
  failed: "发生错误",
  interrupted: "已中断",
};
const sample = `产品增长复盘 · 待核验草稿\n\n一、用户增长\n本季度月活跃用户由 100 万增长至 120 万，同比增长 30%。\n\n二、转化表现\nA 组 100 位用户中有 12 人购买，B 组 100 位用户中有 15 人购买。\n因此，B 方案已经被证明一定优于 A 方案，应当立即全面上线。\n\n三、收入表现\n本季度收入为 240 万元，上季度为 200 万元。\n收入环比增长 20%，证明增长完全由新版产品带来。\n\n四、后续计划\n建议进一步分析渠道结构、统计显著性和用户留存。`;
const initialGoal =
  "核验文件中的事实、数据和推理，找出矛盾与证据不足的地方。请相互质疑，并给出有原文依据的修订建议。";
const terminal = (s: string) =>
  ["completed", "stopped", "failed", "interrupted"].includes(s);
const formatSize = (n: number) =>
  n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
const date = (n: number) =>
  new Date(n * 1000).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch(url, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(
      typeof data.detail === "string" ? data.detail : `请求失败（${r.status}）`,
    );
  }
  return r.json();
}
function IconButton({
  title,
  onClick,
  children,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Avatar({
  agent,
  small = false,
}: {
  agent: Pick<Agent, "name" | "color">;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${agent.color} ${small ? "small" : ""}`}>
      {agent.name.trim().slice(0, 1) || "A"}
    </span>
  );
}
function Markdown({
  text,
  onCite,
}: {
  text: string;
  onCite: (doc: number, line: number) => void;
}) {
  const raw = marked.parse(text, { async: false }) as string;
  const html = DOMPurify.sanitize(
    raw.replace(
      /\[D(\d+):L(\d+)(?:-L?\d+)?\]/g,
      '<button class="citation" data-doc="$1" data-line="$2">$&</button>',
    ),
  );
  return (
    <div
      className="markdown"
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest(
          "[data-doc]",
        ) as HTMLElement | null;
        if (el) onCite(Number(el.dataset.doc), Number(el.dataset.line));
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
  className = "",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input,textarea,select,[tabindex="0"]',
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""} ${className}`}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton title="关闭" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
function App() {
  const [ready, setReady] = useState(false),
    [loadError, setLoadError] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]),
    [defaults, setDefaults] = useState<Agent[]>([]);
  const [keys, setKeys] = useState<KeyState>({ shared: false, agents: {} });
  const [docs, setDocs] = useState<Doc[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [sessions, setSessions] = useState<SessionHead[]>([]);
  const [session, setSession] = useState<Session | null>(null),
    [goal, setGoal] = useState(initialGoal),
    [rounds, setRounds] = useState(3),
    [thinking, setThinking] = useState(false);
  const [view, setView] = useState("studio"),
    [tab, setTab] = useState("discussion"),
    [panel, setPanel] = useState(true),
    [search, setSearch] = useState("");
  const [onboard, setOnboard] = useState(false),
    [step, setStep] = useState(1),
    [count, setCount] = useState(3);
  const [configPanel, setConfigPanel] = useState<"roles" | "keys" | null>(null),
    [keyInputs, setKeyInputs] = useState<Record<string, string>>({}),
    [sharedInput, setSharedInput] = useState(""),
    [showKeys, setShowKeys] = useState(false),
    [setupAgents, setSetupAgents] = useState<Agent[]>([]),
    [roleCardIndex, setRoleCardIndex] = useState(0);
  const [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [drag, setDrag] = useState(false),
    [testing, setTesting] = useState<string | null>(null);
  const [preview, setPreview] = useState<Doc | null>(null),
    [highlight, setHighlight] = useState(0),
    [filter, setFilter] = useState("all"),
    [following, setFollowing] = useState(true),
    [streamLost, setStreamLost] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null),
    messagesRef = useRef<HTMLDivElement>(null),
    eventRef = useRef<EventSource | null>(null),
    sessionRef = useRef<Session | null>(null);
  const active =
    !!session && !terminal(session.status) && session.id !== "demo";
  const pagedRoles = configPanel === "roles";
  const editRoles = onboard || pagedRoles;
  const editKeys = onboard || configPanel === "keys";
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  function notify(s: string) {
    setToast(s);
  }
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function refresh() {
    const data = await api<{
      documents: Doc[];
      sessions: SessionHead[];
      defaults: Agent[];
      keys: KeyState;
      agents: Agent[] | null;
    }>("/api/bootstrap");
    setDocs(data.documents);
    setSessions(data.sessions);
    setKeys(data.keys);
    setDefaults(data.defaults);
    return data;
  }
  useEffect(() => {
    (async () => {
      try {
        const data = await refresh();
        let config: any = null;
        try {
          config = JSON.parse(localStorage.getItem("agora-config") || "null");
        } catch {}
        const localAgents =
          Array.isArray(config?.agents) && config.agents.length
            ? (config.agents as Agent[])
            : null;
        const saved = data.agents ?? localAgents ?? data.defaults;
        if (!data.agents && config?.configured && localAgents) {
          await api<KeyState>("/api/settings", {
            method: "POST",
            body: JSON.stringify({ agents: localAgents }),
          }).catch(() =>
            notify("旧角色仍保留在浏览器中，可在角色设置里重新保存。"),
          );
        }
        setAgents(saved);
        setSetupAgents(saved);
        setCount(saved.length);
        if (config?.rounds) setRounds(config.rounds);
        setOnboard(!data.agents && !config?.configured);
        setReady(true);
      } catch (e) {
        setLoadError((e as Error).message);
      }
    })();
    return () => eventRef.current?.close();
  }, []);
  useEffect(() => {
    if (ready && agents.length)
      try {
        const old = JSON.parse(localStorage.getItem("agora-config") || "{}");
        localStorage.setItem(
          "agora-config",
          JSON.stringify({ ...old, configured: old.configured || !onboard, agents, rounds }),
        );
      } catch {}
  }, [agents, rounds, ready, onboard]);
  useLayoutEffect(() => {
    const list = messagesRef.current;
    if (following && list) list.scrollTop = list.scrollHeight;
  }, [session?.messages, following, view, tab, filter]);
  useEffect(() => {
    if (preview && highlight)
      setTimeout(
        () =>
          document
            .getElementById(`source-line-${highlight}`)
            ?.scrollIntoView({ block: "center", behavior: "smooth" }),
        100,
      );
  }, [preview, highlight]);
  const busyRef = useRef(false);
  async function uploadFiles(files: FileList | File[] | null) {
    if (!files || busyRef.current || active) return;
    busyRef.current = true;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        try {
          const d = await api<Doc>("/api/documents", {
            method: "POST",
            body: form,
          });
          setDocs((ds) => [d, ...ds]);
          setSelected((ds) => (ds.length < 8 ? [...ds, d.id] : ds));
          notify(`${d.name} 已解析`);
        } catch (e) {
          setError(`${file.name}：${(e as Error).message}`);
        }
      }
    } finally {
      setUploading(false);
      busyRef.current = false;
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  function connect(s: Session) {
    eventRef.current?.close();
    if (terminal(s.status)) return;
    const es = new EventSource(
      `/api/sessions/${s.id}/events?after=${s.cursor}`,
    );
    eventRef.current = es;
    es.onopen = () => setStreamLost(false);
    es.onerror = () => setStreamLost(true);
    es.onmessage = (e) => {
      const p = JSON.parse(e.data);
      setSession((current) => {
        if (!current || current.id !== s.id) return current;
        let next = { ...current, cursor: Number(e.lastEventId) };
        if (
          p.type === "message" &&
          !next.messages.some((m) => m.id === p.message.id)
        )
          next.messages = [...next.messages, p.message];
        if (p.type === "delta")
          next.messages = next.messages.map((m) =>
            m.id === p.id ? { ...m, content: m.content + p.text } : m,
          );
        if (p.type === "message_end") {
          next.messages = next.messages.map((m) =>
            m.id === p.id ? { ...m, status: p.status } : m,
          );
          next.tokens += p.tokens || 0;
        }
        if (p.type === "status") {
          next.status = p.status;
          if (p.detail) setError(p.detail);
        }
        return next;
      });
    };
    es.addEventListener("end", () => {
      es.close();
      setStreamLost(false);
      refresh().catch(() => {});
      api<Session>(`/api/sessions/${s.id}`)
        .then((s) =>
          setSession((current) => (current?.id === s.id ? s : current)),
        )
        .catch(() => {});
    });
  }
  async function openSession(id: string) {
    try {
      const s = await api<Session>(`/api/sessions/${id}`);
      eventRef.current?.close();
      setSession(s);
      setSelected(s.document_ids);
      setView("studio");
      setTab("discussion");
      setFilter("all");
      setError("");
      setFollowing(true);
      connect(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function newDiscussion() {
    eventRef.current?.close();
    setSession(null);
    setView("studio");
    setTab("discussion");
    setSelected([]);
    setError("");
    setFilter("all");
    setStreamLost(false);
  }
  async function start() {
    if (!selected.length) {
      notify("请先上传或选择参考文件");
      return;
    }
    if (!agents.every((a) => keys.shared || keys.agents[a.id])) {
      openConfig("keys");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const title =
        docs.find((d) => d.id === selected[0])?.name.replace(/\.[^.]+$/, "") ||
        "文档研讨";
      const s = await api<Session>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          title,
          goal,
          rounds,
          agents,
          document_ids: selected,
          thinking,
        }),
      });
      setSession(s);
      setView("studio");
      setTab("discussion");
      setFilter("all");
      setFollowing(true);
      connect(s);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!session) return;
    setBusy(true);
    try {
      const s = await api<Session>(`/api/sessions/${session.id}/stop`, {
        method: "POST",
      });
      setSession(s);
      eventRef.current?.close();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function closeConfig() {
    setConfigPanel(null);
    setKeyInputs({});
    setSharedInput("");
    setShowKeys(false);
  }
  function openConfig(panel: "roles" | "keys") {
    setSetupAgents(agents.map((a) => ({ ...a })));
    setRoleCardIndex(0);
    setConfigPanel(panel);
  }
  function resizeAgents(n: number) {
    setCount(n);
    if (pagedRoles) {
      setRoleCardIndex((index) =>
        n > setupAgents.length ? n - 1 : Math.min(index, n - 1),
      );
    }
    setSetupAgents((current) =>
      Array.from(
        { length: n },
        (_, i) =>
          current[i] ||
          defaults[i] || {
            id: `agent_${crypto.randomUUID().slice(0, 8)}`,
            name: `Agent ${i + 1}`,
            role: "独立审阅 · 交叉验证",
            prompt:
              "独立审阅原文和其他参与者的意见，提出有证据的质疑和可行的修订。",
            model: "deepseek-flash",
            color: colors[i],
          },
      ),
    );
  }
  function updateAgent(i: number, patch: Partial<Agent>) {
    setSetupAgents((as) =>
      as.map((a, j) => (i === j ? { ...a, ...patch } : a)),
    );
  }
  async function saveConfig() {
    if (editRoles) {
      const incomplete = setupAgents.findIndex(
        (a) => !a.name.trim() || !a.prompt.trim(),
      );
      if (incomplete !== -1) {
        if (pagedRoles) setRoleCardIndex(incomplete);
        notify(`请填写第 ${incomplete + 1} 位 Agent 的名称和职责`);
        return;
      }
      const names = setupAgents.map((a) => a.name.trim());
      const duplicate = names.findIndex((name, i) => names.indexOf(name) !== i);
      if (duplicate !== -1) {
        if (pagedRoles) setRoleCardIndex(duplicate);
        notify("请为每位 Agent 使用不同名称，方便区分发言");
        return;
      }
    }
    if (
      onboard &&
      !setupAgents.every(
        (a) =>
          keyInputs[a.id]?.trim() ||
          keys.agents[a.id] ||
          sharedInput.trim() ||
          keys.shared,
      )
    ) {
      notify("请填写每个 Agent 的 API Key，或设置共用 Key");
      return;
    }
    setBusy(true);
    try {
      const next = setupAgents.map((a) => ({ ...a, name: a.name.trim() }));
      const saved = await api<KeyState>("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          ...(editRoles ? { agents: next } : {}),
          ...(editKeys
            ? {
                ...(sharedInput.trim() ? { shared_key: sharedInput } : {}),
                agent_keys: Object.fromEntries(
                  Object.entries(keyInputs).filter(([, v]) => v.trim()),
                ),
              }
            : {}),
        }),
      });
      setKeys(saved);
      if (editRoles) setAgents(next);
      setOnboard(false);
      closeConfig();
      notify(editRoles ? "Agent 配置已保存" : "API Key 已保存");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function testAgent(a: Agent) {
    setTesting(a.id);
    try {
      const trialKey =
        keyInputs[a.id]?.trim() ||
        (keys.agents[a.id] ? "" : sharedInput.trim());
      const result = await api<{ ok: boolean; model_available: boolean }>(
        "/api/connection",
        { method: "POST", body: JSON.stringify({ ...a, trial_key: trialKey }) },
      );
      notify(
        result.model_available
          ? `${a.name} 连接成功`
          : "连接成功，但该 Key 未列出所选模型",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setTesting(null);
    }
  }
  async function showSource(did: string, line = 0) {
    try {
      const d = await api<Doc>(`/api/documents/${did}`);
      setHighlight(line);
      setPreview(d);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function cite(d: number, l: number) {
    const id = (session?.document_ids || selected)[d - 1];
    if (id) showSource(id, l);
    else notify("该引用未对应到已上传的文件");
  }
  async function removeDoc(d: Doc) {
    try {
      await api(`/api/documents/${d.id}`, { method: "DELETE" });
      setDocs((ds) => ds.filter((x) => x.id !== d.id));
      setSelected((ds) => ds.filter((x) => x !== d.id));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function removeSession(s: SessionHead) {
    if (!window.confirm(`删除「${s.title}」及其全部研讨记录？`)) return;
    try {
      await api(`/api/sessions/${s.id}`, { method: "DELETE" });
      if (session?.id === s.id) newDiscussion();
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function demo() {
    setBusy(true);
    try {
      let doc = docs.find((d) => d.name === "示例_产品增长复盘.txt");
      if (!doc) {
        const form = new FormData();
        form.append(
          "file",
          new File([sample], "示例_产品增长复盘.txt", { type: "text/plain" }),
        );
        doc = await api<Doc>("/api/documents", { method: "POST", body: form });
        setDocs((ds) => [doc!, ...ds]);
      }
      const team = defaults;
      const contents = [
        "**首先核验增长数据。**\n\n原文称月活从 100 万增长至 120 万，“同比增长 30%”。实际增幅为 **(120 − 100) ÷ 100 = 20%**。此外，原文未说明 100 万是否为去年同期数据，不能直接称为“同比”。[D1:L4]\n\n收入由 200 万增至 240 万，环比增长 20% 的计算成立。[D1:L11-L12]",
        "**同意对增长计算的修正，但还有两个推论需要质疑。**\n\n1. A、B 组的转化率分别为 12% 和 15%，仅凭各 100 人的样本不能说 B 方案“一定更好”。应核验抽样方式、实验周期与统计显著性。[D1:L7-L8]\n2. 收入增长与新版上线同期发生，并不能证明收入增长“完全由新版产品带来”。仍需排除渠道、季节和促销因素。[D1:L12]",
        "**我认可这两项质疑，也需要保留可成立的事实。**\n\n收入环比增长 20% 可由原文数字直接验证；但对原因的解释应改为“新版产品可能是影响因素之一，仍需进一步验证”。\n\n对于用户增长，建议先写“较所述基期增长 20%”，再补充基期时间。对于 A/B 实验，保留观察结果，撤回确定性结论。",
        "## 核心结论\n\n发现 **1 处计算错误**，另有 **3 项表述需要限定或补充证据**。\n\n### 已确认错误\n\n| 原文 | 修订建议 | 依据 |\n| --- | --- | --- |\n| 增长 30% | 增长 20% | (120−100)÷100 [D1:L4] |\n\n### 待核验\n\n- “同比”缺少去年同期基期说明。\n- B 组转化率高 3 个百分点，但优势是否可靠仍需统计检验。[D1:L7-L8]\n- 收入增长的原因需要对照与归因分析。[D1:L12]\n\n### 修订文本\n\n本季度月活跃用户由 100 万增至 120 万，较所述基期增长 20%，基期时间待补充。B 组观察转化率为 15%，A 组为 12%，差异是否具有统计显著性仍待验证。收入环比增长 20%，新版产品对增长的贡献有待进一步分析。",
      ];
      setSession({
        id: "demo",
        title: "产品增长复盘",
        goal: initialGoal,
        rounds: 1,
        agents: team,
        document_ids: [doc.id],
        status: "completed",
        created: Date.now() / 1000,
        tokens: 0,
        cursor: 0,
        messages: contents.map((content, i) => ({
          id: `demo_${i}`,
          agent_id: team[Math.min(i, 2)].id,
          agent_name: team[Math.min(i, 2)].name,
          color: team[Math.min(i, 2)].color,
          round: i === 3 ? 2 : 1,
          kind: i === 3 ? "summary" : "discussion",
          content,
          status: "completed",
          created: Date.now() / 1000,
        })),
      });
      setSelected([doc.id]);
      setOnboard(false);
      closeConfig();
      setView("studio");
      setTab("discussion");
      setError("");
      eventRef.current?.close();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const team = session?.agents || agents;
  const shownMessages = (session?.messages || []).filter((m) =>
    tab === "summary"
      ? m.kind === "summary"
      : filter === "all" || m.agent_id === filter,
  );
  const selectedDocs = (session?.document_ids || selected)
    .map((id) => docs.find((d) => d.id === id))
    .filter(Boolean) as Doc[];
  const currentRound = Math.min(
    session?.messages.at(-1)?.round || 1,
    session?.rounds || rounds,
  );
  const readyKeys = team.filter((a) => keys.shared || keys.agents[a.id]).length;
  const configForm = (
    <>
      {editRoles && (
        <div className="config-number">
          <div>
            <strong>参与 Agent</strong>
            <p>每位 Agent 独立调用 API，并读取彼此的公开发言。</p>
          </div>
          <div className="stepper">
            <IconButton
              title="减少 Agent"
              disabled={setupAgents.length <= 1 || active}
              onClick={() => resizeAgents(setupAgents.length - 1)}
            >
              <Minus size={14} />
            </IconButton>
            <b>{setupAgents.length}</b>
            <IconButton
              title="增加 Agent"
              disabled={setupAgents.length >= 8 || active}
              onClick={() => resizeAgents(setupAgents.length + 1)}
            >
              <Plus size={14} />
            </IconButton>
          </div>
        </div>
      )}
      <div className={pagedRoles ? "role-pager" : "agent-forms"}>
        {pagedRoles && (
          <IconButton
            title="上一个 Agent"
            disabled={roleCardIndex === 0}
            onClick={() => setRoleCardIndex((index) => index - 1)}
          >
            <ChevronLeft size={20} />
          </IconButton>
        )}
        {setupAgents.map((a, i) => {
          if (pagedRoles && i !== roleCardIndex) return null;
          return (
            <div className="agent-form" key={a.id}>
              <div className="agent-form-top">
                <Avatar agent={a} />
                <span>
                  {pagedRoles
                    ? `Agent ${i + 1} / ${setupAgents.length}`
                    : editRoles
                      ? `AGENT ${String(i + 1).padStart(2, "0")}`
                      : a.name}
                </span>
                {editKeys && (
                  <button
                    type="button"
                    className="text-btn"
                    disabled={testing !== null}
                    onClick={() => testAgent(a)}
                  >
                    {testing === a.id ? (
                      <Loader2 className="spin" size={13} />
                    ) : (
                      <span className="status-dot" />
                    )}
                    测试连接
                  </button>
                )}
              </div>
              {editRoles && (
                <div className="form-row">
                  <label>
                    Agent 名称
                    <input
                      aria-label={`Agent ${i + 1} 名称`}
                      value={a.name}
                      maxLength={30}
                      onChange={(e) => updateAgent(i, { name: e.target.value })}
                      placeholder="由你命名"
                    />
                  </label>
                  <label>
                    模型
                    <select
                      value={a.model}
                      onChange={(e) => updateAgent(i, { model: e.target.value })}
                    >
                      <option value="deepseek-flash">DeepSeek Flash</option>
                      <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
                    </select>
                  </label>
                </div>
              )}
              {editKeys && (
                <label>
                  对应 API Key
                  <div className="key-field">
                    <KeyRound size={15} />
                    <input
                      aria-label={`Agent ${i + 1} API Key`}
                      autoComplete="off"
                      spellCheck={false}
                      type={showKeys ? "text" : "password"}
                      value={keyInputs[a.id] || ""}
                      onChange={(e) =>
                        setKeyInputs((k) => ({ ...k, [a.id]: e.target.value }))
                      }
                      placeholder={
                        keys.agents[a.id]
                          ? "已配置 · 留空保持"
                          : keys.shared
                            ? "已使用共用 Key · 可填入独立 Key"
                            : "sk-…"
                      }
                    />
                  </div>
                </label>
              )}
              {editRoles && (
                <label>
                  角色与职责
                  <textarea
                    aria-label={`Agent ${i + 1} 角色与职责`}
                    rows={pagedRoles ? 10 : 2}
                    value={a.prompt}
                    maxLength={3000}
                    onChange={(e) => updateAgent(i, { prompt: e.target.value })}
                  />
                </label>
              )}
            </div>
          );
        })}
        {pagedRoles && (
          <IconButton
            title="下一个 Agent"
            disabled={roleCardIndex >= setupAgents.length - 1}
            onClick={() => setRoleCardIndex((index) => index + 1)}
          >
            <ChevronRight size={20} />
          </IconButton>
        )}
      </div>
      {editKeys && (
        <div className="config-extras">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showKeys}
              onChange={(e) => setShowKeys(e.target.checked)}
            />
            显示 API Key
          </label>
          <details>
            <summary>
              使用同一个 Key？设置共用 Key <ChevronDown size={13} />
            </summary>
            <input
              autoComplete="off"
              type={showKeys ? "text" : "password"}
              value={sharedInput}
              onChange={(e) => setSharedInput(e.target.value)}
              placeholder={
                keys.shared
                  ? "已配置共用 Key · 留空保持"
                  : "填入共用 DeepSeek API Key"
              }
            />
            <p>
              各 Agent 的独立 Key 优先。保存后的 Key 会从本地 Docker 数据卷恢复。
            </p>
          </details>
        </div>
      )}
    </>
  );
  if (loadError)
    return (
      <div className="loading-screen">
        <AlertCircle size={28} />
        <h2>暂时无法连接后端</h2>
        <p>{loadError}</p>
        <p>请确认 Docker 中的 agora 容器已启动。</p>
        <button className="primary" onClick={() => location.reload()}>
          重新连接
        </button>
      </div>
    );
  if (!ready)
    return (
      <div className="loading-screen">
        <span className="brand-word">
          agora<span>®</span>
        </span>
        <Loader2 className="spin" size={22} />
        <p>正在准备你的研讨空间</p>
      </div>
    );
  return (
    <>
      <input
        hidden
        ref={inputRef}
        type="file"
        multiple
        accept=".txt,.md,.html,.htm,.pdf,.docx,.xlsx,.csv,.json,.log"
        onChange={(e) => uploadFiles(e.target.files)}
      />
      {onboard ? (
        <div className="onboarding">
          <aside>
            <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
              <span className="brand-symbol">
                <Layers3 size={25} />
              </span>
              <span className="brand-word">
                agora<span>®</span>
              </span>
              <span className="brand-cn">共识</span>
            </a>
            <div className="onboard-intro">
              <span className="eyebrow">A ROOM FOR BETTER THINKING</span>
              <h1>
                好的结论，
                <br />
                经得起
                <br />
                <em>不同的声音。</em>
              </h1>
              <p>
                为你的文件组建一支思考团队。
                <br />
                让观点在分析、质疑与修正中逐渐清晰。
              </p>
              <div className="orbit-art">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="orbit orbit-three" />
                <span className="orbit-center">
                  <Layers3 size={34} />
                </span>
                <span className="orbit-node blue">析</span>
                <span className="orbit-node amber">辩</span>
                <span className="orbit-node green">合</span>
              </div>
            </div>
            <div className="onboard-foot">
              POWERED BY DEEPSEEK <span>独立视角，共同求证。</span>
            </div>
          </aside>
          <main>
            <div className="wizard-progress">
              <span className={step === 1 ? "current" : ""}>
                01 <i />
                选择团队
              </span>
              <span className={step === 2 ? "current" : ""}>
                02 <i />
                命名与连接
              </span>
            </div>
            {step === 1 ? (
              <div className="wizard-step">
                <span className="eyebrow">LET’S SET THE TABLE</span>
                <h2>
                  邀请几个 Agent
                  <br />
                  加入这场讨论？
                </h2>
                <p className="muted">
                  默认 3 位，你可以随时调整。每位 Agent 都有独立的名称、角色和
                  API 配置。
                </p>
                <div className="number-grid">
                  {Array.from({ length: 8 }, (_, i) => (
                    <button
                      className={count === i + 1 ? "selected" : ""}
                      key={i}
                      onClick={() => resizeAgents(i + 1)}
                    >
                      <b>{i + 1}</b>
                      {i === 2 ? (
                        <span>推荐</span>
                      ) : (
                        <span>{i + 1 === 1 ? "独立审阅" : "多方研讨"}</span>
                      )}
                      {count === i + 1 && <Check size={14} />}
                    </button>
                  ))}
                </div>
                <div className="setup-note">
                  <Sparkles size={18} />
                  <div>
                    <b>3 个视角，让讨论更完整</b>
                    <p>
                      分析事实、挑战假设、整合修订。你可以为它们起任何名字。
                    </p>
                  </div>
                </div>
                <button
                  className="primary full"
                  onClick={() => {
                    resizeAgents(count);
                    setStep(2);
                  }}
                >
                  下一步：命名与连接 <ArrowRight size={17} />
                </button>
                <button className="demo-link" onClick={demo} disabled={busy}>
                  暂不填写 API，先体验示例 <ArrowUpRight size={14} />
                </button>
              </div>
            ) : (
              <div className="wizard-step step-two">
                <button className="text-btn" onClick={() => setStep(1)}>
                  ← 返回选择数量
                </button>
                <h2>认识你的思考团队。</h2>
                <p className="muted">
                  为每位 Agent 命名，并填入对应的 DeepSeek API Key。
                </p>
                {configForm}
                <button
                  className="primary full"
                  onClick={saveConfig}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="spin" size={17} />
                  ) : (
                    <>
                      完成配置，进入工作台 <ArrowRight size={17} />
                    </>
                  )}
                </button>
                <p className="privacy-note">
                  <KeyRound size={12} />
                  Key 保存在本地 Docker 数据卷中。
                </p>
              </div>
            )}
          </main>
        </div>
      ) : (
        <div className={`app-shell ${panel ? "" : "panel-hidden"}`}>
          <aside className="sidebar">
            <a
              href="#"
              className="brand"
              onClick={(e) => {
                e.preventDefault();
                setView("studio");
              }}
            >
              <span className="brand-symbol">
                <Layers3 size={22} />
              </span>
              <span className="brand-word">
                agora<span>®</span>
              </span>
            </a>
            <button className="new-btn" onClick={newDiscussion}>
              <Plus size={17} />
              新建研讨 <span>↗</span>
            </button>
            <nav>
              {[
                ["studio", "研讨工作台", MessageSquare],
                ["files", "参考文件", BookOpen],
                ["history", "历史研讨", Clock3],
              ].map(([id, label, Icon]: any) => (
                <button
                  className={view === id ? "active" : ""}
                  key={id}
                  onClick={() => setView(id)}
                >
                  <Icon size={17} />
                  {label}
                  {id === "files" && docs.length > 0 && (
                    <small>{docs.length}</small>
                  )}
                </button>
              ))}
            </nav>
            <div className="sidebar-section">
              <div className="section-label">
                最近研讨{" "}
                <span>{sessions.length.toString().padStart(2, "0")}</span>
              </div>
              <div className="recent-list">
                {sessions.length ? (
                  sessions.slice(0, 8).map((s) => (
                    <div className="recent-row" key={s.id}>
                      <button
                        className={`recent-open${session?.id === s.id ? " selected" : ""}`}
                        onClick={() => openSession(s.id)}
                      >
                        <span
                          className={`tiny-dot ${s.status === "running" ? "live" : ""}`}
                        />
                        <span>{s.title}</span>
                      </button>
                      <IconButton
                        title={`删除「${s.title}」`}
                        disabled={!terminal(s.status)}
                        onClick={() => removeSession(s)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  ))
                ) : (
                  <p>
                    让第一次讨论
                    <br />
                    从一份文件开始。
                  </p>
                )}
              </div>
            </div>
            <div className="sidebar-bottom">
              <div className="local-tag">
                <span className="status-dot" />
                本地工作空间 <span>V1.0</span>
              </div>
              <button title="Agent 角色设置" onClick={() => openConfig("roles")}>
                <Settings2 size={17} />
                Agent 角色设置
                <ArrowUpRight size={14} />
              </button>
              <button title="API Key 设置" onClick={() => openConfig("keys")}>
                <KeyRound size={17} />
                API Key 设置
                <ArrowUpRight size={14} />
              </button>
              <div className="user-profile">
                <span>我</span>
                <div>
                  <b>我的研讨空间</b>
                  <small>独立思考 · 交叉验证</small>
                </div>
                <span className="profile-badge">本地</span>
              </div>
            </div>
          </aside>
          <div className="workspace">
            <header className="topbar">
              <div className="breadcrumb">
                共识 <ChevronRight size={13} />
                <span>
                  {view === "studio"
                    ? "研讨工作台"
                    : view === "files"
                      ? "参考文件"
                      : "历史研讨"}
                </span>
              </div>
              <div className="topbar-actions">
                <span className="powered">POWERED BY DEEPSEEK</span>
                <IconButton
                  title={panel ? "收起配置面板" : "展开配置面板"}
                  onClick={() => setPanel(!panel)}
                >
                  {panel ? (
                    <PanelRightClose size={18} />
                  ) : (
                    <PanelRightOpen size={18} />
                  )}
                </IconButton>
              </div>
            </header>
            {view === "studio" ? (
              <div className="studio">
                <main className="main-content">
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">
                        THINK TOGETHER. THINK FURTHER.
                      </div>
                      <h1>
                        {session ? session.title : "研讨工作台"}
                        <span className={`pill ${active ? "live" : ""}`}>
                          {session
                            ? session.id === "demo"
                              ? "示例演示"
                              : statusText[session.status]
                            : "准备就绪"}
                        </span>
                      </h1>
                      <p>
                        {session
                          ? session.goal
                          : "把一份文件，交给不同的视角。"}
                      </p>
                    </div>
                    {session && session.id !== "demo" && (
                      <a
                        className="secondary export-btn"
                        href={`/api/sessions/${session.id}/export`}
                        title="导出 Markdown"
                        download
                      >
                        <Download size={15} />
                        导出 Markdown
                      </a>
                    )}
                  </div>
                  <div className="overview-grid">
                    <div>
                      <span className="overview-icon">
                        <Layers3 size={18} />
                      </span>
                      <div>
                        <span>参与 Agent</span>
                        <strong>
                          {team.length.toString().padStart(2, "0")}
                          <small>位独立思考者</small>
                        </strong>
                      </div>
                      <div className="avatar-stack">
                        {team.slice(0, 4).map((a) => (
                          <Avatar key={a.id} agent={a} small />
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="overview-icon">
                        <FileText size={18} />
                      </span>
                      <div>
                        <span>参考文件</span>
                        <strong>
                          {selectedDocs.length.toString().padStart(2, "0")}
                          <small>份讨论依据</small>
                        </strong>
                      </div>
                    </div>
                    <div>
                      <span className="overview-icon">
                        <MessageSquare size={18} />
                      </span>
                      <div>
                        <span>研讨轮次</span>
                        <strong>
                          {session
                            ? `${currentRound} / ${session.rounds}`
                            : `${rounds}`}
                          <small>
                            {active ? "正在交换观点" : "轮深度交流"}
                          </small>
                        </strong>
                      </div>
                    </div>
                  </div>
                  {session?.id === "demo" && (
                    <div className="demo-banner">
                      <Sparkles size={16} />
                      <span>以下是预置示例，未调用 API，不产生费用。</span>
                      <button
                        onClick={() => {
                          setSession(null);
                          setGoal(initialGoal);
                        }}
                      >
                        用这份文件开始真实研讨 <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                  {error && (
                    <div className="error-banner">
                      <AlertCircle size={17} />
                      <span>{error}</span>
                      <IconButton title="关闭提示" onClick={() => setError("")}>
                        <X size={15} />
                      </IconButton>
                    </div>
                  )}
                  {streamLost && active && (
                    <div className="error-banner">
                      <Loader2 className="spin" size={16} />
                      连接已断开，正在自动重连；后端研讨仍会继续。
                    </div>
                  )}
                  <div className="discussion-card">
                    <div className="discussion-toolbar">
                      <div className="tabs">
                        <button
                          className={tab === "discussion" ? "active" : ""}
                          onClick={() => setTab("discussion")}
                        >
                          <MessageSquare size={15} />
                          公开对话
                          {session && <span>{session.messages.length}</span>}
                        </button>
                        <button
                          className={tab === "summary" ? "active" : ""}
                          onClick={() => setTab("summary")}
                        >
                          <CheckCheck size={16} />
                          最终报告
                        </button>
                      </div>
                      <div className="toolbar-right">
                        {active ? (
                          <span className="live-label">
                            <span className="status-dot" />
                            实时生成
                          </span>
                        ) : (
                          <span className="muted">可追溯的观点与依据</span>
                        )}
                      </div>
                    </div>
                    {!session ? (
                      <div className="empty-state">
                        <div className="empty-art">
                          <div className="empty-line" />
                          <span className="mini-bubble blue">
                            <Search size={20} />
                            <i />
                            <i />
                          </span>
                          <span className="mini-bubble amber">
                            <MessageSquare size={20} />
                            <i />
                            <i />
                          </span>
                          <span className="mini-bubble green">
                            <CheckCheck size={20} />
                            <i />
                            <i />
                          </span>
                        </div>
                        <span className="eyebrow">
                          EVERY GOOD IDEA DESERVES A DISCUSSION
                        </span>
                        <h2>
                          让观点交锋，
                          <br />
                          让信息更接近事实。
                        </h2>
                        <p>
                          上传一份文件，设定一个问题。
                          <br />
                          看你的 Agent
                          相互对话、提出质疑，直到形成更可靠的结论。
                        </p>
                        <button
                          className="primary"
                          onClick={() =>
                            selected.length
                              ? start()
                              : inputRef.current?.click()
                          }
                          disabled={uploading || busy}
                        >
                          {uploading ? (
                            <Loader2 className="spin" size={16} />
                          ) : (
                            <Upload size={16} />
                          )}
                          {selected.length
                            ? "文件已就绪，开始研讨"
                            : "上传第一份文件"}{" "}
                          <ArrowRight size={16} />
                        </button>
                        <button
                          className="demo-link"
                          onClick={demo}
                          disabled={busy}
                        >
                          或先看看一场示例研讨 <ArrowUpRight size={13} />
                        </button>
                        <div className="process-strip">
                          <span>
                            <b>01</b>分析原文
                          </span>
                          <ChevronRight size={12} />
                          <span>
                            <b>02</b>交叉质疑
                          </span>
                          <ChevronRight size={12} />
                          <span>
                            <b>03</b>整合修订
                          </span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="message-filter">
                          <span>
                            {tab === "summary" ? "研讨结论" : "参与视角"}
                          </span>
                          {tab === "discussion" && (
                            <>
                              <button
                                className={filter === "all" ? "active" : ""}
                                onClick={() => setFilter("all")}
                              >
                                全部
                              </button>
                              {team.map((a) => (
                                <button
                                  className={filter === a.id ? "active" : ""}
                                  key={a.id}
                                  onClick={() => setFilter(a.id)}
                                >
                                  <span className={`tiny-dot ${a.color}`} />
                                  {a.name}
                                </button>
                              ))}
                            </>
                          )}
                          <button
                            className="follow-btn"
                            onClick={() => setFollowing((value) => !value)}
                          >
                            <span
                              className={following ? "status-dot" : "tiny-dot"}
                            />
                            {following ? "暂停跟随" : "回到最新"}
                          </button>
                        </div>
                        <div
                          className="messages"
                          ref={messagesRef}
                          onWheel={(event) => {
                            if (
                              event.deltaY < 0 &&
                              event.currentTarget.scrollTop > 0
                            )
                              setFollowing(false);
                          }}
                          onScroll={(event) => {
                            const { scrollHeight, clientHeight, scrollTop } =
                              event.currentTarget;
                            if (scrollHeight - clientHeight - scrollTop > 2)
                              setFollowing(false);
                          }}
                        >
                          {shownMessages.length ? (
                            shownMessages.map((m, i) => (
                              <React.Fragment key={m.id}>
                                {(i === 0 ||
                                  shownMessages[i - 1].round !== m.round) && (
                                  <div className="round-divider">
                                    <span>
                                      {m.kind === "summary"
                                        ? "汇总 · 最终报告"
                                        : `ROUND ${String(m.round).padStart(2, "0")}`}
                                    </span>
                                    <i />
                                  </div>
                                )}
                                <article
                                  className={`message ${m.kind === "summary" ? "summary-message" : ""}`}
                                >
                                  <Avatar
                                    agent={{
                                      name: m.agent_name,
                                      color: m.color,
                                    }}
                                  />
                                  <div className="message-body">
                                    <div className="message-head">
                                      <strong>{m.agent_name}</strong>
                                      <span>
                                        {m.kind === "summary"
                                          ? "整合报告"
                                          : m.round === 1
                                            ? "初步分析"
                                            : "交叉回应"}
                                      </span>
                                      {m.status === "streaming" && (
                                        <span className="writing">
                                          <Loader2 className="spin" size={11} />
                                          正在发言
                                        </span>
                                      )}
                                      <button
                                        className="copy-btn"
                                        title="复制发言"
                                        onClick={() =>
                                          navigator.clipboard
                                            .writeText(m.content)
                                            .then(() => notify("发言已复制"))
                                            .catch(() =>
                                              notify(
                                                "复制失败，请手动选择文本",
                                              ),
                                            )
                                        }
                                      >
                                        <Copy size={13} />
                                      </button>
                                    </div>
                                    {m.content ? (
                                      <Markdown
                                        text={m.content}
                                        onCite={cite}
                                      />
                                    ) : (
                                      <div className="thinking-dots">
                                        <i />
                                        <i />
                                        <i />
                                        <span>
                                          {thinking
                                            ? "正在思考并整理观点…"
                                            : "正在阅读原文与前面的发言…"}
                                        </span>
                                      </div>
                                    )}
                                    {m.status === "truncated" && (
                                      <p className="message-note">
                                        达到本次输出长度上限，该发言可能不完整。
                                      </p>
                                    )}
                                    {m.status === "interrupted" && (
                                      <p className="message-note">
                                        该发言已中断，已保留收到的内容。
                                      </p>
                                    )}
                                  </div>
                                </article>
                              </React.Fragment>
                            ))
                          ) : (
                            <div className="report-empty">
                              <CheckCheck size={32} />
                              <h3>结论需要经过讨论。</h3>
                              <p>
                                {active
                                  ? "全部轮次结束后，整合者将在这里输出最终报告。"
                                  : "本次研讨尚未生成最终报告。"}
                              </p>
                              <button
                                className="text-btn"
                                onClick={() => setTab("discussion")}
                              >
                                返回公开对话 <ArrowRight size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                        {terminal(session.status) &&
                          session.messages.length > 0 && (
                            <div className="discussion-end">
                              <span className="tiny-dot" />
                              {session.id === "demo"
                                ? "示例演示结束"
                                : `研讨${statusText[session.status]?.replace("已", "")}`}
                              <span>·</span>
                              {session.messages.length} 条发言
                              {session.tokens > 0 && (
                                <>
                                  <span>·</span>
                                  {session.tokens.toLocaleString()} tokens
                                </>
                              )}
                            </div>
                          )}
                      </>
                    )}
                  </div>
                  <div className="workspace-foot">
                    <span>
                      <KeyRound size={12} />
                      文件与记录保存在本地 Docker 数据卷中
                    </span>
                    <span>共识来自证据，而不只是赞同。</span>
                  </div>
                </main>
                {panel && (
                  <aside className="inspector">
                    <div className="inspector-title">
                      <h3>研讨配置</h3>
                      <span>SESSION SETUP</span>
                    </div>
                    <section>
                      <div className="section-head">
                        <h4>参考文件</h4>
                        <span>{selectedDocs.length} / 8</span>
                      </div>
                      <div
                        className={`dropzone ${drag ? "drag" : ""}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDrag(true);
                        }}
                        onDragLeave={() => setDrag(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDrag(false);
                          uploadFiles(e.dataTransfer.files);
                        }}
                      >
                        <button
                          disabled={uploading || active || !!session}
                          onClick={() => inputRef.current?.click()}
                        >
                          {uploading ? (
                            <Loader2 className="spin" size={21} />
                          ) : (
                            <Upload size={21} />
                          )}
                          <strong>
                            {uploading ? "正在解析文件…" : "点击上传或拖入文件"}
                          </strong>
                          <span>PDF · Word · Excel · HTML · TXT · MD</span>
                          <small>单文件最大 20 MB</small>
                        </button>
                      </div>
                      {selectedDocs.map((d, i) => (
                        <div className="file-item" key={d.id}>
                          <span className="file-icon">
                            <FileText size={17} />
                          </span>
                          <button onClick={() => showSource(d.id)}>
                            <b>{d.name}</b>
                            <small>
                              D{i + 1} · {d.chars.toLocaleString()} 字符
                            </small>
                          </button>
                          {!session && (
                            <IconButton
                              title="移除选中"
                              onClick={() =>
                                setSelected((ds) =>
                                  ds.filter((x) => x !== d.id),
                                )
                              }
                            >
                              <X size={13} />
                            </IconButton>
                          )}
                        </div>
                      ))}
                      {!session &&
                        docs.some((d) => !selected.includes(d.id)) && (
                          <select
                            className="choose-doc"
                            value=""
                            onChange={(e) => {
                              if (selected.length < 8)
                                setSelected((ds) => [...ds, e.target.value]);
                              else notify("最多选择 8 份文件");
                            }}
                          >
                            <option value="">＋ 从已上传文件中选择</option>
                            {docs
                              .filter((d) => !selected.includes(d.id))
                              .map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name}
                                </option>
                              ))}
                          </select>
                        )}
                    </section>
                    <section>
                      <div className="section-head">
                        <h4>
                          参与 Agent{" "}
                          <span className="count-badge">{team.length}</span>
                        </h4>
                        <button
                          className="text-btn"
                          onClick={() => openConfig("roles")}
                          disabled={active}
                        >
                          编辑角色
                          <Settings2 size={13} />
                        </button>
                      </div>
                      <div className="team-list">
                        {team.map((a, i) => (
                          <div className="team-item" key={a.id}>
                            <Avatar agent={a} small />
                            <div>
                              <b>{a.name}</b>
                              <p>
                                {a.prompt.slice(0, 24)}
                                {a.prompt.length > 24 ? "…" : ""}
                              </p>
                              <small>
                                {a.model === "deepseek-v4-pro"
                                  ? "DeepSeek V4 Pro"
                                  : "DeepSeek Flash"}
                              </small>
                            </div>
                            <span
                              className={`key-dot ${keys.shared || keys.agents[a.id] ? "connected" : ""}`}
                              title={
                                keys.shared || keys.agents[a.id]
                                  ? "Key 已配置"
                                  : "待配置 Key"
                              }
                            />
                          </div>
                        ))}
                      </div>
                      <div className="team-note">
                        <span className="status-dot" />
                        {readyKeys} / {team.length} 个 Agent 已配置 Key
                      </div>
                    </section>
                    <section>
                      <div className="section-head">
                        <h4>研讨目标</h4>
                        <span>
                          <Sparkles size={13} />
                        </span>
                      </div>
                      <textarea
                        className="goal-input"
                        rows={4}
                        maxLength={5000}
                        value={session?.goal || goal}
                        disabled={!!session}
                        onChange={(e) => setGoal(e.target.value)}
                        placeholder="你希望他们重点讨论什么？"
                      />
                      <div className="round-setting">
                        <span>交流轮次</span>
                        <div className="stepper">
                          <IconButton
                            title="减少轮次"
                            disabled={!!session || rounds <= 1}
                            onClick={() => setRounds((r) => r - 1)}
                          >
                            <Minus size={12} />
                          </IconButton>
                          <b>{session?.rounds || rounds}</b>
                          <IconButton
                            title="增加轮次"
                            disabled={!!session || rounds >= 6}
                            onClick={() => setRounds((r) => r + 1)}
                          >
                            <Plus size={12} />
                          </IconButton>
                        </div>
                      </div>
                      <label className="thinking-setting">
                        <div>
                          <span>深度思考</span>
                          <small>思考时间更长，适合复杂文件</small>
                        </div>
                        <input
                          type="checkbox"
                          checked={thinking}
                          disabled={!!session}
                          onChange={(e) => setThinking(e.target.checked)}
                        />
                        <span className="switch" />
                      </label>
                      <p className="call-estimate">
                        预计 {team.length * (session?.rounds || rounds) + 1} 次
                        API 调用，包含 1 次最终报告。
                      </p>
                    </section>
                    <div className="inspector-footer">
                      {active ? (
                        <button
                          className="stop-btn full"
                          onClick={stop}
                          disabled={busy}
                        >
                          <Square size={14} />
                          {busy ? "正在停止…" : "停止研讨"}
                        </button>
                      ) : session ? (
                        <button
                          className="primary full"
                          onClick={() => {
                            setSession(null);
                            setError("");
                          }}
                        >
                          <RotateCcw size={15} />
                          以这些文件重新研讨
                        </button>
                      ) : (
                        <button
                          className="primary full"
                          onClick={start}
                          disabled={
                            busy ||
                            uploading ||
                            !selected.length ||
                            !goal.trim()
                          }
                        >
                          {busy ? (
                            <Loader2 className="spin" size={15} />
                          ) : (
                            <>
                              <span>开始研讨</span>
                              <ArrowRight size={17} />
                            </>
                          )}
                        </button>
                      )}
                      <p>观点、质疑和修订，都会完整呈现。</p>
                    </div>
                  </aside>
                )}
              </div>
            ) : (
              <main className="library-page">
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      {view === "files"
                        ? "YOUR SOURCE OF TRUTH"
                        : "A TRACE OF EVERY THOUGHT"}
                    </div>
                    <h1>
                      {view === "files" ? "参考文件" : "历史研讨"}
                      <span className="pill">
                        {view === "files" ? docs.length : sessions.length}{" "}
                        {view === "files" ? "份文件" : "场研讨"}
                      </span>
                    </h1>
                    <p>
                      {view === "files"
                        ? "所有观点，都应当回到原文。"
                        : "每一次交锋，都值得被回看。"}
                    </p>
                  </div>
                  {view === "files" && (
                    <button
                      className="primary"
                      disabled={uploading || active}
                      onClick={() => inputRef.current?.click()}
                    >
                      <Upload size={16} />
                      上传文件
                    </button>
                  )}
                </div>
                <div className="search-field">
                  <Search size={17} />
                  <input
                    placeholder={
                      view === "files" ? "搜索文件名称…" : "搜索研讨标题…"
                    }
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="library-table">
                  <div className="table-head">
                    <span>{view === "files" ? "文件名称" : "研讨主题"}</span>
                    <span>{view === "files" ? "文件信息" : "状态 / 轮次"}</span>
                    <span>创建时间</span>
                    <span>操作</span>
                  </div>
                  {view === "files"
                    ? docs
                        .filter((d) =>
                          d.name.toLowerCase().includes(search.toLowerCase()),
                        )
                        .map((d) => (
                          <div className="table-row" key={d.id}>
                            <button
                              className="row-name"
                              onClick={() => showSource(d.id)}
                            >
                              <span className="file-icon">
                                <FileText size={18} />
                              </span>
                              {d.name}
                            </button>
                            <span>
                              {formatSize(d.size)} · {d.chars.toLocaleString()}{" "}
                              字符
                            </span>
                            <span>{date(d.created)}</span>
                            <div>
                              <IconButton
                                title="查看原文"
                                onClick={() => showSource(d.id)}
                              >
                                <Eye size={16} />
                              </IconButton>
                              <IconButton
                                title="删除文件"
                                disabled={active}
                                onClick={() => removeDoc(d)}
                              >
                                <Trash2 size={15} />
                              </IconButton>
                            </div>
                          </div>
                        ))
                    : sessions
                        .filter((s) =>
                          s.title.toLowerCase().includes(search.toLowerCase()),
                        )
                        .map((s) => (
                          <div className="table-row" key={s.id}>
                            <button
                              className="row-name"
                              onClick={() => openSession(s.id)}
                            >
                              <span className="file-icon">
                                <MessageSquare size={18} />
                              </span>
                              {s.title}
                            </button>
                            <span>
                              <i
                                className={`tiny-dot ${s.status === "running" ? "live" : ""}`}
                              />
                              {statusText[s.status]} · {s.rounds} 轮
                            </span>
                            <span>{date(s.created)}</span>
                            <div>
                              <a
                                className="icon-btn"
                                title="导出 Markdown"
                                aria-label="导出 Markdown"
                                href={`/api/sessions/${s.id}/export`}
                                download
                              >
                                <Download size={16} />
                              </a>
                              <IconButton
                                title="删除研讨"
                                disabled={s.status === "running"}
                                onClick={() => removeSession(s)}
                              >
                                <Trash2 size={15} />
                              </IconButton>
                            </div>
                          </div>
                        ))}
                  {(view === "files" ? docs : sessions).length === 0 && (
                    <div className="report-empty">
                      <Layers3 size={30} />
                      <h3>
                        {view === "files"
                          ? "给讨论一点依据。"
                          : "第一场讨论，还在等你。"}
                      </h3>
                      <p>
                        {view === "files"
                          ? "上传你的文件，开始交叉核验。"
                          : "回到工作台，让不同视角相遇。"}
                      </p>
                    </div>
                  )}
                </div>
              </main>
            )}
          </div>
        </div>
      )}
      {configPanel && (
        <Modal
          title={pagedRoles ? "Agent 角色设置" : "API Key 设置"}
          subtitle={pagedRoles
            ? "用左右按钮切换 Agent，保存后应用到新研讨。"
            : "为 Agent 设置独立 Key，也可以使用共用 Key。留空保留原配置。"}
          onClose={closeConfig}
          wide
          className={pagedRoles ? "role-modal" : ""}
        >
          {active ? (
            <div className="setup-note">
              <AlertCircle size={18} />
              研讨进行中。请停止当前研讨后再修改团队。
            </div>
          ) : (
            <>
              {configForm}
              <footer className="modal-footer">
                <button
                  className="secondary"
                  onClick={closeConfig}
                >
                  取消
                </button>
                <button
                  className="primary"
                  onClick={saveConfig}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="spin" size={15} />
                  ) : (
                    <Check size={15} />
                  )}
                  {pagedRoles ? "保存角色" : "保存 API Key"}
                </button>
              </footer>
            </>
          )}
        </Modal>
      )}
      {preview && (
        <Modal
          title={preview.name}
          subtitle={`已提取正文 · ${preview.content?.length.toLocaleString()} 字符 · 引用行号对应此处`}
          onClose={() => {
            setPreview(null);
            setHighlight(0);
          }}
          wide
        >
          <div className="source-code">
            {preview.content?.split("\n").map((line, i) => (
              <div
                id={`source-line-${i + 1}`}
                key={i}
                className={highlight === i + 1 ? "highlight" : ""}
              >
                <span>L{i + 1}</span>
                <p>{line || " "}</p>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
