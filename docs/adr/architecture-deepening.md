# Architecture Deepening Record

本文档记录了 voice-to-text 项目的 5 次架构深化，按执行顺序排列。所有深化遵循
"深模块"原则：在窄接口背后隐藏更多复杂度，提升局部性（locality）和杠杆（leverage）。

## 术语

| 术语 | 含义 |
|------|------|
| **模块** | 任何有接口和实现的单元（函数、类、文件） |
| **接口** | 调用者必须了解的一切：类型、不变量、错误模式 |
| **深度** | 接口的杠杆——小接口背后的大量行为 |
| **接缝** | 可以在不原地编辑的情况下改变行为的位置 |
| **局部性** | 变更和 bug 集中在一个地方 |

---

## ADR-001: 合并 QuestionExtractor 为单一模块

**状态**: 已实施  
**日期**: 2026-04-28

### 背景

问题提取功能分散在三个地方：
- `questionExtractor.js`（27 行）：对 LLM 的 pass-through
- `localQuestionExtractor.js`（50 行）：正则匹配
- `ragOrchestrator.js` 第 16-31 行：fallback 逻辑（try/catch + 阈值判断）

两个提取器都是浅模块——接口几乎和实现一样复杂。真正的复杂度（切换策略、阈值）泄漏到了 orchestrator。

### 决策

合并为单一 `questionExtractor.js`，导出 `extractQuestion(transcript)` 和 `generateSearchQuery(transcript)`。Cloud/local 成为内部策略，fallback 逻辑沉入模块内部。

### 影响

- **文件变更**: 删除 `localQuestionExtractor.js`，重写 `questionExtractor.js`，简化 `ragOrchestrator.js`
- **接口**: `extractQuestion(transcript) → {question, confidence, method} | null`
- **杠杆提升**: orchestrator 从 15 行 try/catch 变为一行调用
- **局部性提升**: 提取策略、阈值、fallback 集中在一个模块内

---

## ADR-002: IPC 声明式路由表

**状态**: 已实施  
**日期**: 2026-04-28

### 背景

`main.js` 中有 15+ 个 IPC handler，每个都重复相同的 try/catch + `{success, error}` 包装模式。这是浅层复制粘贴——接口和实现复杂度几乎相等。新增 IPC 通道需要同步修改 3 处（handler、preload、renderer）。

### 决策

引入 `ipcRouter.js`，提供 `registerIPC(routes)` 函数。`main.js` 中的所有 handler 重构为声明式路由表对象。统一的 try/catch 包装由 router 处理。

### 影响

- **新文件**: `src/lib/ipcRouter.js`（12 行）
- **接口**: `registerIPC({ 'channel-name': async (ctx, ...args) => result })`
- **杠杆提升**: 新增通道从写 3 处变为写 1 处路由条目
- **局部性提升**: 错误处理策略（如加 logging）只改一处

---

## ADR-003: 提取 InterviewEngine 模块

**状态**: 已实施  
**日期**: 2026-04-28

### 背景

`main.js` 的 `ai-completion` handler 是一个 70 行函数，包含 4 个分支（summarizer / interviewer-evaluate / interviewer-recommend / copilot），每个分支自行组装 messages、调用 LLM、决定是否走 RAG。这是浅路由表——接口看似简单但实现分散。

### 决策

提取 `InterviewEngine` 类，接口为 `process(text, mode, background, send)`。所有分支逻辑、RAG 决策、prompt 组装、流式输出沉入模块。IPC handler 退化为一行调用。

### 影响

- **新文件**: `src/lib/interviewEngine.js`
- **接口**: `process(text, mode, background, send) → void`（通过 send 回调流式输出）
- **杠杆提升**: IPC handler 从 70 行变为 1 行
- **局部性提升**: 面试逻辑可脱离 Electron 独立测试

---

## ADR-004: 拆分 renderer.js 为领域模块

**状态**: 已实施  
**日期**: 2026-04-28

### 背景

`renderer.js` 是一个 1,111 行的单文件，用 ~20 个全局变量承担了录音控制、段落管理、AI 对话、知识库管理、历史记录等全部 UI 逻辑。没有接口可言——全是顶层副作用。零局部性：改知识库编辑器需要理解 VAD 静音检测。

### 决策

按领域概念拆分为 5 个模块：

| 模块 | 文件 | 职责 |
|------|------|------|
| SegmentManager | `renderer/segmentManager.js` | 转写段落的状态管理和渲染 |
| AudioRecorder | `renderer/audioRecorder.js` | 录音生命周期、VAD、音频流 |
| AIChat | `renderer/aiChat.js` | AI 对话流、RAG 调试面板、PDF Agent 流 |
| KnowledgeBase | `renderer/knowledgeBase.js` | 知识库全屏管理界面 |
| Settings | `renderer/settings.js` | 设置、模式切换、历史记录、PDF 列表 |

`renderer.js` 退化为 ~90 行的组合入口：DOM 查询 + 模块初始化 + 少量跨模块胶水。

### 影响

- **新目录**: `src/renderer/`（5 个文件）
- **renderer.js**: 1,111 行 → ~90 行
- **局部性提升**: 知识库 bug 只看 knowledgeBase.js；录音问题只看 audioRecorder.js
- **杠杆提升**: 新增面试模式只需修改 settings.js 的 switchMode + 对应面板
- **可测试性**: 每个模块可通过注入 mock elements/electronAPI 进行单元测试

---

## ADR-005: LocalVectorStore 分离 ChunkSplitter

**状态**: 已实施  
**日期**: 2026-04-28

### 背景

`pineconeService.js`（407 行）的 `LocalVectorStore` 同时承担 3 个职责：
1. 向量搜索（核心运行时功能）
2. 文档 CRUD（核心运行时功能）
3. 文本分块（`splitIntoChunks`、`splitMarkdownByHeadings`）——仅在 ingest 时使用

分块逻辑是一次性操作，和运行时搜索无关。混在同一个类里降低了局部性。

### 决策

将分块逻辑提取为独立的 `chunkSplitter.js` 模块，导出 `splitPdfIntoChunks(pdfData, chunkSize)` 和 `splitMarkdownByHeadings(text)`。`LocalVectorStore` 内部导入使用，但分块算法的变更不影响搜索和 CRUD 的代码。

### 影响

- **新文件**: `src/lib/chunkSplitter.js`
- **接口**: 纯函数，输入文档数据，输出 chunk 数组
- **局部性提升**: 分块算法变更（如改为语义分块）只改 chunkSplitter.js
- **可测试性**: 分块逻辑变为纯函数，可直接单元测试，不需要文件系统或 embedding 依赖

---

## 重构后的模块依赖图

```
renderer.js (入口, ~90 行)
  ├── renderer/segmentManager.js    (段落管理)
  ├── renderer/audioRecorder.js     (录音 + VAD)
  ├── renderer/aiChat.js            (AI 对话)
  ├── renderer/knowledgeBase.js     (知识库 UI)
  └── renderer/settings.js          (设置 + 历史)

main.js (入口, 声明式路由)
  ├── lib/ipcRouter.js              (IPC 注册)
  ├── lib/interviewEngine.js        (面试引擎)
  │     ├── lib/ragOrchestrator.js  (RAG 编排)
  │     │     ├── lib/questionExtractor.js  (统一问题提取)
  │     │     ├── lib/pineconeService.js    (向量存储)
  │     │     └── lib/webSearch.js          (Web 搜索)
  │     └── lib/prompts.js          (Prompt 模板)
  ├── lib/pineconeService.js        (向量存储)
  │     └── lib/chunkSplitter.js    (文本分块)
  ├── lib/resumeAnalyzer.js         (PDF 分析 Agent)
  ├── lib/asrEngine.js              (ASR 引擎分发)
  │     └── lib/localASR.js         (本地 ASR)
  ├── lib/modelDownloader.js        (模型管理)
  └── lib/gemini.js                 (LLM 客户端)
```

## 下一步建议

1. **向量存储升级**: 将 LocalVectorStore 内部替换为 SQLite + sqlite-vec，接口不变
2. **测试基础设施**: 给 questionExtractor、chunkSplitter、interviewEngine 加 Vitest 单元测试
3. **凭证安全**: 迁移 API key 到 Electron safeStorage
