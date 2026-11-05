# 共识 Agora

使用 DeepSeek API，让多个由你命名的 Agent 分析文件、相互质疑、纠错并提出修订建议，全部公开发言实时显示。

**代码前后端分离，Docker 只有一个容器。** `frontend/` 是 React + TypeScript 界面，`backend/` 是 Python API；根目录 Dockerfile 编译前端，将其产物和后端一起打包。Docker Desktop 中网页容器直接叫 **`agora`**，端口直接显示在这一行。

## Windows 一键启动

启动 Docker Desktop（Linux containers 模式），双击桌面项目里的 `启动 Agora.bat`。

脚本会完成 Docker 构建、启动与健康检查，再实测首页和 API，成功后打开 [http://localhost:3000](http://localhost:3000)。Docker Desktop 的 `agora` 行会显示可点击的 **`3000:8000`**。

更新启动脚本会自动替换本项目的旧容器，保留原来的 `agora_agora-data` 数据卷和历史记录。

终端运行同一个启动流程：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-docker.ps1
```

可选参数：`-SkipBuild` 使用现有镜像，`-Port 3001` 修改端口，`-NoBrowser` 禁止自动打开浏览器。ExecutionPolicy 仅作用于这次 PowerShell 进程，不修改系统策略。

## 纯 Docker 命令

一键脚本最终运行的部署结构也可以手动创建：

```bash
docker build -t agora:local .
docker volume create agora_agora-data
docker run -d --name agora --restart unless-stopped --init -p 127.0.0.1:3000:8000 -v agora_agora-data:/data agora:local
```

如果名为 `agora` 的容器已经存在，直接从 Docker Desktop 启动它，或运行 `docker start agora`。更新代码需要重建镜像并替换容器，使用一键脚本即可处理。

默认绑定本机 `127.0.0.1:3000`。网页和 API 都通过这个端口访问，不需要独立后端容器或额外端口。

```text
浏览器 localhost:3000
           │ Docker 端口映射 3000:8000
           ▼
       agora 容器
           ├── /          编译后的 React 前端
           ├── /assets/*  JavaScript、CSS
           ├── /api/*     Python / FastAPI 后端
           └── /data      SQLite → agora_agora-data 数据卷
```

## 首次使用

1. 选择 Agent 数量，默认 3 个，可设为 1–8 个。
2. 为每个 Agent 自己命名，填写对应的 DeepSeek API Key，可修改职责和模型。
3. 上传文件，填写研讨目标，选择 1–6 轮，开始研讨。

每个 Agent 可以使用不同 Key，也可复用同一个 Key。独立 Key 优先于可选共用 Key。Key 不需要写进代码，也不需要发到聊天中。

首次保存后再次打开 Agora 会直接进入工作台。在侧栏的「Agent 角色设置」修改名字、模型和职责，在「API Key 设置」更新独立或共用 Key。

默认模型 `deepseek-flash`，可切换 `deepseek-v4-pro`，支持深度思考。模型和调用格式依据 [DeepSeek 官方文档](https://api-docs.deepseek.com/) 接入。

## 文件支持

| 格式 | 处理方式 |
| --- | --- |
| HTML / HTM | 提取正文、标题和表格，不执行脚本，过滤样式和 iframe 等 |
| TXT / MD / CSV / JSON / LOG | 支持 UTF-8、带 BOM 的 UTF-16、GB18030 |
| PDF | 提取文字并保留页码标记，扫描件需要先 OCR |
| DOCX | 按正文顺序读取段落与表格 |
| XLSX | 按工作表读取单元格缓存值，公式依赖文件中已保存的计算结果 |

单文件最大 20 MB、120,000 字符；一次最多 8 个文件，带行号后的总文本上限 160,000 字符。PDF 最多 250 页，XLSX 最多 20,000 行。超过限制会明确报错，不会静默截断。旧版 DOC / XLS 请先转换。

解析后可预览正文，点击发言中的 `[D1:L3]` 可以定位原文行号。

## 研讨和报告

默认角色模板是分析者、质疑者、整合者，名称和职责都可修改。每轮依次发言，每位 Agent 读取原文和已经完成的全部公开发言，后续轮次继续交叉回应。

全部轮次结束后，最后一位 Agent 再调用一次 API 汇总报告。3 个 Agent、3 轮共 **3 × 3 + 1 = 10 次 API 调用**。一次运行一场研讨，点击停止会取消当前上游请求并保留收到的内容；已处理的内容仍可能被 DeepSeek 计费。

可筛选角色发言、切换最终报告、复制内容、回看历史，并导出包含行号原文和完整发言的 Markdown。示例演示明确标注为预置内容，不调用 API、不产生费用。

## 保存与隐私

- 文件提取正文和公开发言存于本机 `agora_agora-data` 数据卷，重建容器不会清空数据。
- 界面保存的 API Key 和 Agent 设置存于本机 Docker 数据卷内权限受限的 `settings.sqlite3`。重启服务后自动恢复，浏览器只收到 Key 的配置状态。
- 轮数偏好保存在当前浏览器 localStorage。
- 执行真实研讨时，选中文档的提取正文和公开发言会发送给 DeepSeek。
- 刷新页面不会停止研讨；SSE 按事件序号续接，历史记录可恢复实时进度。
- 服务重启后，未完成研讨标记为中断，不自动重试付费请求。
- 多个 Agent 达成一致不代表外部事实已经证实；当前版本不联网搜索，证据不足的内容应标记待核验。

## 常用命令

```bash
docker ps -a --filter name=agora
docker port agora 8000
docker logs -f agora
docker stop agora
docker start agora

# 使用隔离临时数据库测试，不调用真实 API
docker run --rm agora:local python -m unittest discover -s backend/tests -v
```

端口冲突时，将 `.env.example` 复制为 `.env` 并修改 `AGORA_PORT=3001`，然后重新运行一键脚本。共用 Key 也可通过 `.env` 的 `DEEPSEEK_API_KEY` 注入，作为未保存共用 Key 时的默认值。不要提交真实 `.env`。

## 源码结构与开发

```text
agora/
├── frontend/                  独立 React / TypeScript 前端源码及依赖
├── backend/                   独立 Python API 源码、依赖及测试
├── Dockerfile                 Node 构建前端 → 单个 Python 运行镜像
├── .dockerignore              排除密钥、Git、缓存和本地构建产物
├── scripts/start-docker.ps1    单容器启动、旧部署迁移与实际访问验证
├── 启动 Agora.bat             Windows 双击入口
├── examples/                  HTML 示例文件
└── tests/                     可选 Playwright 浏览器测试
```

单独开发前端时，在 `frontend/` 执行 `npm ci` 和 `npm run dev`，Vite 会把 `/api` 转发到本机 8000 端口。后端设置可写 `DATA_DIR` 后运行 `uvicorn backend.app:app --port 8000`。只有生产镜像提供前端构建产物时，后端才挂载静态文件。

可选浏览器测试需要 Node.js，在 `tests/` 中执行：

```bash
npm install
npx playwright install chromium
npm test
```

测试验证首次人数/名称/Key 配置、真实 HTML 上传和预览、SSE 发言、报告、引用行定位与手机布局。测试用 Key 和研讨响应在浏览器路由内模拟，不调用真实 DeepSeek。临时上传会自动清理，截图保存在被 Git 忽略的 `test-results/`。
