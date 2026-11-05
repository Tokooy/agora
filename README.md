# 共识 Agora

一个基于 DeepSeek API 的多 Agent 文档研讨工作台。上传文件后，让你命名的多个 Agent 依次分析、相互质疑、核验数据，并形成带原文引用的修订报告。全部公开发言实时显示。

中性白底、深灰文字与石墨色按钮的中文界面，前后端独立，使用 Docker 编译和运行，无需本机安装 Node.js 或 Python。

## 启动

安装并启动 Docker Desktop（Linux containers 模式），在此文件夹打开终端：

```bash
docker compose up -d --build
```

打开 [http://localhost:3000](http://localhost:3000)。Windows 也可以双击 `启动 Agora.bat`。

首次打开时：

1. 选择 Agent 数量（1–8 个，默认 3 个）。
2. 为每个 Agent 填写自己的名字和对应 DeepSeek API Key，可调整职责和模型。
3. 完成配置，上传文件，填写研讨目标，选择轮数，点击“开始研讨”。

不同 Agent 可以使用不同 Key，也可复用同一个 Key。独立 Key 优先于可选共用 Key。Key 不需要填进代码，也不需要发到聊天中。

## 前后端分离

```text
浏览器 :3000
    │
    ▼
frontend / Nginx                独立前端容器
    ├── /                      React 静态页面
    └── /api/* ──反向代理──► backend / FastAPI :8000
                                    │  独立后端容器
                                    ├── DeepSeek HTTPS API
                                    └── SQLite → agora-data 数据卷
```

`frontend/` 与 `backend/` 分别有自己的依赖文件和 Dockerfile。Compose 负责网络连接、后端健康检查和数据持久化。后端不映射宿主端口；前端默认只绑定本机 `127.0.0.1:3000`。

## 文件支持

| 格式 | 处理方式 |
| --- | --- |
| HTML / HTM | 提取正文、标题和表格，移除脚本、样式、iframe 等，不执行 HTML |
| TXT / MD / CSV / JSON / LOG | 读取文本，支持 UTF-8、带 BOM 的 UTF-16、GB18030 |
| PDF | 提取文字并保留页码标记；扫描件需要先 OCR |
| DOCX | 按正文顺序读取段落与表格 |
| XLSX | 按工作表读取缓存后的单元格值 |

单文件最大 20 MB、120,000 字符；一次最多选择 8 个文件，带行号后的总文本上限 160,000 字符。PDF 最多 250 页，XLSX 最多 20,000 行。超过限制会明确报错，不会静默截断。旧版 DOC / XLS 请先转换；Excel 公式依赖文件内已保存的计算结果。

文件解析后可以预览正文。发言中的 `[D1:L3]` 引用可点击，直接定位到对应文件行号。HTML 源文件中的脚本、事件处理器和外链资源不会执行。

## 研讨如何进行

默认提供三个可修改的角色模板：分析者、质疑者、整合者。名称和职责完全由你修改。

每轮按团队顺序依次发言，每个 Agent 都会收到原文和本次研讨中已经完成的全部公开发言。因此后发言者能明确回应、反驳和纠正先前观点。第 2 轮开始进一步交叉回应。轮数可设为 1–6；全部轮次结束后，由最后一个 Agent 再调用一次 API 汇总最终报告。

例如 3 个 Agent、3 轮，共调用 **3 × 3 + 1 = 10 次 API**。一次只运行一场研讨，避免后台意外叠加调用。点击“停止研讨”会取消正在进行的上游 HTTP 请求，并保留已经收到的文字；DeepSeek 对已处理内容仍可能计费。

默认模型 `deepseek-flash`，可切换 `deepseek-v4-pro`，并可开启深度思考。接口与模型名称依据 [DeepSeek 官方文档](https://api-docs.deepseek.com/) 接入；文本通过 Chat Completions SSE 流式返回。页面只展示公开观点、证据和修订依据。

“体验示例”使用明确标注的预置对话，不调用 API。真实运行中的网络错误、无效 Key、余额不足、限流和输出截断都会显示对应提示。未进行真实 API 调用的演示不会显示虚构 Token 用量。

## 保存、恢复与隐私

- 文件的提取正文、完整公开对话和引用保存在本机 Docker 命名数据卷 `agora_agora-data`。
- API Key 只保存在后端进程内存，不返回给前端、不进入 SQLite、导出文件或 Git。容器重建或重启后需重新填写。
- Agent 名称、职责、模型与轮数保存在当前浏览器的 localStorage，不包含 Key。建议单人本机使用。
- 为执行研讨，选中文档的提取文本及既有公开发言会发送到 DeepSeek。
- 刷新或暂时离开页面不会停止后端研讨，重新打开历史研讨会恢复进度。SSE 断线后按事件序号续接，不重复拼接已收到的片段。
- 服务重启后，未完成研讨标记为“已中断”，不会自动重新调用付费 API。可以选择“以这些文件重新研讨”。
- 历史记录可导出为 Markdown，包含行号原文及全部公开发言。删除关联文件前，需先删除引用它的研讨。

本应用核验基于上传原文的计算、逻辑和证据。多个 Agent 达成一致不等于外部事实被证实；没有外部来源支持的内容会被要求标记为“待核验”。当前版本不执行联网搜索。

## 常用命令

```bash
# 查看前后端状态
docker compose ps

# 查看日志
docker compose logs -f

# 停止；保留文件和历史
docker compose down

# 重新编译更新
docker compose up -d --build

# 运行后端自动化测试（使用隔离的临时数据库，不访问真实 API）
docker compose run --rm --no-deps backend python -m unittest discover -s backend/tests -v
```

如 3000 端口已被占用，将 `.env.example` 复制为 `.env`，修改 `AGORA_PORT=3001` 后重新启动。共用 Key 也可以通过 `.env` 的 `DEEPSEEK_API_KEY` 注入；该方式会由 Docker 保存到容器环境中，和界面输入的仅内存方案不同。不要把 `.env` 提交到 Git。

## 项目结构

```text
agora/
├── frontend/
│   ├── src/main.tsx         配置向导、工作台、文件库、SSE 对话与报告
│   ├── src/style.css        中性白底、深色文字与响应式视觉样式
│   ├── package-lock.json    固定前端依赖
│   ├── nginx.conf           API 反向代理，关闭 SSE 缓冲
│   └── Dockerfile           Node 编译 → Nginx 运行
├── backend/
│   ├── app.py               解析、研讨编排、DeepSeek 流、存储与 REST API
│   ├── tests/test_app.py    解析、上下文传递、停止、异常及密钥边界测试
│   ├── requirements.txt     固定后端依赖
│   └── Dockerfile           Python / FastAPI 运行环境
├── examples/               可上传的演示文件
├── compose.yaml            两个独立服务与持久化数据卷
├── .env.example            可选端口与共用 Key 配置模板
└── 启动 Agora.bat           Windows Docker 启动入口
```

需要单独开发时，前端运行 `npm ci && npm run dev`，Vite 把 `/api` 转发到本机 8000 端口。后端设置可写的 `DATA_DIR` 并运行 `uvicorn backend.app:app --port 8000`。正式交付按上述 Docker 命令编译即可。

## 浏览器流程验证

主程序仍只需要 Docker。可选浏览器测试位于 `tests/`，需要测试机安装 Node.js：

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

测试连接本机已启动的 `http://localhost:3000`，验证首次选择人数、命名、对应 Key 输入、真实 HTML 文件上传和原文预览、SSE 对话呈现、报告切换、引用行定位、示例标注与手机布局。Key、研讨创建与上游响应在浏览器路由内模拟，不会请求真实 DeepSeek。测试产生的临时文件会自动清理，截图输出到被 Git 忽略的 `test-results/`。
