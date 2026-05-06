# AI 面试助手 (voice-to-text)

基于 Electron 的 AI 面试助手，支持实时语音转写、RAG 知识检索和智能面试辅助。

## 功能

- **实时语音转写** — 云端（豆包 ASR）或本地（sherpa-onnx Paraformer）双引擎
- **系统音频捕获** — macOS ScreenCaptureKit，无需 BlackHole 等虚拟声卡
- **面试者模式** — VAD 自动分段 → AI 提取问题 → RAG 搜索知识库 + Web → 流式生成参考答案
- **面试官模式** — 输入 JD，AI 推荐面试问题 / 评估候选人回答
- **PDF/Markdown 知识库** — 上传文档自动分析、分块、向量化；二级分组（岗位→领域）自动分类；全屏管理界面支持 CRUD、搜索、自动分类
- **跨岗位智能搜索** — 加权评分而非硬过滤，当前岗位优先但跨岗位问题也能命中
- **对话上下文感知** — 多轮面试对话缓冲，结合上下文理解面试官真正意图
- **RAG 调试面板** — 可视化问题提取 → 搜索 → 排序 → Prompt 组装的全流程

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 API Key
npm start
```

## 环境变量（`.env`）

| 变量 | 用途 | 必填 |
|------|------|------|
| `LLM_API_KEY` | LLM API 密钥（OpenAI 兼容） | 是 |
| `LLM_BASE_URL` | LLM API 地址，默认 `https://api.openai.com/v1` | 否 |
| `MAIN_MODEL` | 主模型名称，默认 `vtrix-gemini-3-flash-preview` | 否 |
| `FAST_MODEL` | 快速模型（embedding 等），默认同 MAIN_MODEL | 否 |
| `EMBEDDING_BASE_URL` | Embedding API 地址；不填则复用 `LLM_BASE_URL` | 否 |
| `EMBEDDING_API_KEY` | Embedding API 密钥；不填则复用 `LLM_API_KEY` | 否 |
| `EMBEDDING_MODEL` | Embedding 模型，默认 `text-embedding-3-small` | 否 |
| `TAVILY_API_KEY` | Tavily Web 搜索 API 密钥 | 否（无则跳过 Web 搜索） |
| `DOUBAO_API_KEY` | 豆包 ASR API 密钥 | 否（仅云端识别需要） |

## 技术栈

- Electron 41 + Electron Forge + Vite
- sherpa-onnx-node（本地 ASR）
- OpenAI SDK（LLM，兼容接口）
- Tavily（Web 搜索）
- 本地向量存储（cosine similarity）

## 构建

```bash
npm run package   # 打包
npm run make      # 生成安装包
```
