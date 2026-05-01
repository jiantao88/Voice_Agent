# voice-to-text — AI 面试助手

## 项目结构

```
src/
├── main.js                     Electron 主进程入口，声明式 IPC 路由表
├── preload.js                  contextBridge API 暴露
├── renderer.js                 渲染进程入口（~90 行），组合 5 个 UI 模块
├── renderer/
│   ├── segmentManager.js       转写段落状态管理和渲染
│   ├── audioRecorder.js        录音生命周期、VAD、音频流
│   ├── aiChat.js               AI 对话流、RAG 调试面板
│   ├── knowledgeBase.js        知识库全屏管理界面
│   └── settings.js             设置、模式切换、历史记录
├── lib/
│   ├── ipcRouter.js            IPC 声明式注册（12 行）
│   ├── interviewEngine.js      面试引擎：分模式处理 + RAG 决策
│   ├── ragOrchestrator.js      RAG 管道：问题提取 → 搜索 → 排序 → Prompt
│   ├── questionExtractor.js    统一问题提取（cloud + local fallback）
│   ├── pineconeService.js      本地向量存储 + 文档 CRUD + 分组
│   ├── chunkSplitter.js        文本分块（PDF 按句、Markdown 按标题）
│   ├── resumeAnalyzer.js       PDF 分析 4 步 Agent
│   ├── gemini.js               LLM 客户端（OpenAI 兼容接口）
│   ├── asrEngine.js            ASR 引擎抽象层（豆包 / sherpa-onnx）
│   ├── localASR.js             sherpa-onnx 本地 ASR 封装
│   ├── modelDownloader.js      模型下载器（GitHub Releases）
│   ├── webSearch.js            Tavily Web 搜索
│   ├── prompts.js              Prompt 模板
│   └── safePdfParse.js         pdf-parse 安全封装
└── index.html / index.css      页面和样式
```

## 开发命令

```bash
npm start          # 启动开发模式
npm run package    # 打包
npm run make       # 生成安装包
```

## 环境变量

`.env` 文件放项目根目录，必填 `LLM_API_KEY`。完整列表见 README.md。

## IPC 通道清单

| 通道 | 方向 | 用途 |
|------|------|------|
| `start-doubao-stream` | renderer→main | 启动 ASR |
| `send-audio-chunk` | renderer→main | 发送 PCM 音频数据 |
| `stop-doubao-stream` | renderer→main | 停止 ASR |
| `check-local-model` | renderer→main | 检测本地模型状态 |
| `download-local-model` | renderer→main | 下载本地 ASR 模型 |
| `transcribe-audio` | renderer→main | 一次性音频识别（legacy） |
| `ai-completion` | renderer→main | AI 面试处理 |
| `upload-pdf` | renderer→main | 上传 PDF/Markdown |
| `delete-pdf` | renderer→main | 删除 PDF 及其知识 |
| `list-pdfs` | renderer→main | 列出已上传文件 |
| `list-chunks` / `get-chunk` / `update-chunk` / `delete-chunk` / `add-chunk` | renderer→main | 知识块 CRUD |
| `list-groups` / `save-groups` / `set-document-group` | renderer→main | 分组管理 |
| `enable-loopback-audio` / `disable-loopback-audio` | renderer→main | 系统音频捕获 |
| `stream-result` / `stream-error` | main→renderer | ASR 结果推送 |
| `ai-stream` / `ai-stream-end` / `ai-question` / `rag-debug` | main→renderer | AI 流式输出 |
| `model-download-progress` | main→renderer | 模型下载进度 |
| `pdf-agent-stream` | main→renderer | PDF 分析进度 |

## 架构约定

- IPC handler 通过 `ipcRouter.js` 声明式注册，新增通道只需在 `main.js` 的 `routes` 对象加一行
- 渲染进程按领域拆分为 5 个模块，通过 `renderer.js` 组合
- 面试逻辑集中在 `interviewEngine.js`，IPC handler 只做一行调用
- 向量存储数据在 `userData/vectors.json`，分组在 `userData/groups.json`
- 本地 ASR 模型存储在 `userData/models/paraformer-bilingual/`
