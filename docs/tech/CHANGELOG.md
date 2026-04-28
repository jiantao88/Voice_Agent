# 技术改动记录

## 2026-04-28 — 集成 sherpa-onnx 本地语音识别

**动机：** 原有豆包云端 ASR 依赖网络且有 API 费用，发现端侧模型（如 SenseVoice、Paraformer）已足够成熟，决定集成本地识别能力。

**模型选型：** 对比了 Whisper、SenseVoice、Paraformer 等 9 个模型，最终选择 sherpa-onnx + Paraformer 流式双语模型：
- 支持中英文混合识别（CER 1.68%）
- 流式推理，延迟低
- int8 量化后约 230MB，CPU 可跑
- sherpa-onnx-node npm 包有 Node.js binding

**新增文件：**
- `src/lib/modelDownloader.js` — 模型下载器，从 GitHub Releases 下载 tar.bz2 并解压到 `userData/models/paraformer-bilingual/`，支持断点检测和进度回调
- `src/lib/localASR.js` — sherpa-onnx OnlineRecognizer 封装，Int16→Float32 音频转换，endpoint 检测，输出格式与豆包一致
- `src/lib/asrEngine.js` — ASR 引擎抽象层（策略模式），统一 start/feedAudio/stop 接口，内含完整豆包 WebSocket 二进制协议

**重构：**
- `src/main.js` — 删除约 220 行豆包协议代码（移入 asrEngine.js），IPC handlers 改为调用 asrEngine 分发，新增 `check-local-model` 和 `download-local-model` IPC
- `src/preload.js` — 新增 checkLocalModel / downloadLocalModel / onModelDownloadProgress API
- `vite.main.config.mjs` — 添加 `sherpa-onnx-node` 到 rollup externals
- `forge.config.js` — asar unpack 配置 `**/*.{node,dylib,so,dll}` 以支持 native 模块
- `package.json` — 新增 `sherpa-onnx-node` 依赖

**关键技术细节：**
- 音频格式：16kHz、16-bit Int16 单声道 PCM，每 chunk 4096 samples（~256ms）
- sherpa-onnx API 流程：`createStream()` → `acceptWaveform({sampleRate, samples: Float32Array})` → `decode()` → `getResult().text` → `isEndpoint()` → `reset()`
- 豆包协议：gzip 压缩的二进制 WebSocket，4 字节 header + payload

---

## 2026-04-28 — 知识库数据持久化修复

**问题：** 上传 PDF 生成的知识文档在重启后消失，`vectors.json` 为空数组。

**根因：** `resumeAnalyzer.storeKnowledge()` 推入 documents 时缺少新增字段（id/group/sourceType/timestamps），且 `generateEmbedding()` 异常时整个 push 被跳过。

**修复：**
- 补全所有必要字段
- embedding 失败改为非致命（存空数组），确保数据不丢失
- 存储前先删除同文件名旧知识文档

---

## 2026-04-28 — 本地向量存储数据模型升级

**改动文件：** `src/lib/pineconeService.js`

**新增字段：** id（UUID）、group（分组名）、sourceType（pdf/markdown/manual）、createdAt/updatedAt（时间戳）

**迁移策略：** `load()` 时自动检测旧数据并回填默认值，迁移后自动保存

**新增功能：**
- Chunk CRUD：getChunks / getChunkById / updateChunk / deleteChunk / addChunk
- 分组管理：getGroups / saveGroups / setDocumentGroup（独立 groups.json）
- Markdown 上传：uploadMarkdown + splitMarkdownByHeadings
- 搜索支持 group 过滤

---

## 2026-04-28 — RAG 管道增强

**改动文件：** `src/lib/ragOrchestrator.js`

- 支持 group 过滤（传入 options.group 限定搜索范围）
- 新增 debug 模式：收集完整 trace（extractedQuestion → searchQuery → pdfResults → webResults → rankedResults → promptContext → timings）

---

## 2026-04-27 — 系统音频捕获（ScreenCaptureKit）

**动机：** 面试场景需要同时识别对方声音，之前需要安装 BlackHole 虚拟声卡。

**方案：** 利用 Chromium 内置 ScreenCaptureKit 支持（macOS），通过 `setDisplayMediaRequestHandler` + `audio: 'loopback'` 捕获系统音频，AudioContext 混合麦克风和系统音频后送入 ASR。

**涉及文件：** main.js（Chromium feature flags + IPC）、preload.js、renderer.js（AudioContext 混合）、index.html（开关）

---

## 2026-04-27 — AI 面试助手核心架构

**从零搭建的模块：**
- `src/lib/gemini.js` — Vtrix AI API 封装（OpenAI 兼容），流式 + 非流式 + embedding
- `src/lib/ragOrchestrator.js` — RAG 管道：问题提取 → 知识库搜索 → Web 搜索 → 排序 → Prompt 组装
- `src/lib/pineconeService.js` — 本地向量存储（cosine similarity），替代 Pinecone 云服务
- `src/lib/resumeAnalyzer.js` — PDF 分析 4 步 Agent：解析 → 技术栈分析 → 知识文档生成 → 向量化存储
- `src/lib/questionExtractor.js` + `localQuestionExtractor.js` — 面试问题提取
- `src/lib/webSearch.js` — Tavily Web 搜索集成
- `src/lib/safePdfParse.js` — pdf-parse 安全封装

---

## 2026-04-26 — 项目初始化

- Electron Forge + Vite 脚手架
- 豆包（Doubao）流式 ASR 集成：WebSocket 二进制协议、gzip 压缩
- VAD 静音检测自动分段
- 基础 UI：录音按钮 + 实时转写区域
