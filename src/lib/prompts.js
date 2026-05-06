export function buildPrompt(bg, conversation) {
  return `You are an expert AI interview assistant helping with technical interview questions. Provide clear, concise, and helpful responses based on your knowledge.

${bg ? `Background Context: ${bg}` : ''}

Recent Interview Conversation:
${conversation}

Provide a helpful response:`;
}

export function buildKnowledgeCheckPrompt(conversation) {
  return `You are an AI assistant that needs to determine if you have sufficient knowledge to answer a question.

Conversation: ${conversation}

Analyze this conversation and determine:
1. Is there a clear question being asked?
2. Do you have sufficient knowledge to provide a comprehensive answer?
3. Or would you need external documents/context to give a complete response?

Respond with ONLY one of these formats:
- "KNOWN: [brief answer preview]" - if you can answer comprehensively
- "NEED_CONTEXT: [what specific information you need]" - if you need external sources

Examples:
- For "What is React?" → "KNOWN: React is a JavaScript library..."
- For "What's my GPA?" → "NEED_CONTEXT: Personal academic information"
- For "Company policy on remote work?" → "NEED_CONTEXT: Specific company policies"`;
}

export function buildRAGPrompt(bg, conversation, extractedQuestion, context) {
  return `You are an expert AI interview assistant. Use the provided context along with your knowledge to give the most comprehensive and accurate answer possible.

Context Information:
${context}

${bg ? `Background: ${bg}` : ''}

Question: ${extractedQuestion}

Provide a clear, comprehensive response using both the context and your expertise:`;
}

export function buildContextualRAGPrompt(bg, conversation, history, extractedQuestion, context) {
  const historyBlock = history
    ? `\n对话历史（用于理解追问上下文）:\n${history}\n`
    : '';

  return `你是一位专业的面试助手。基于提供的知识库上下文、对话历史和你的专业知识，给出最全面准确的回答。

知识库上下文:
${context}

${bg ? `背景信息: ${bg}` : ''}
${historyBlock}
当前问题: ${extractedQuestion}

请用中文回答，简洁有条理，重点突出:`;
}

export function buildSummarizerPrompt(text) {
  return `You are a summarizer. Summarize the following text. Only write summary.
Content:
${text}
Summary:
`;
}

export function buildInterviewerPrompt(resume, jd, transcript) {
  return `你是一位资深的技术面试官。请根据候选人的简历和职位要求，分析面试对话并提供评估。

${resume ? `候选人简历摘要：\n${resume}\n` : ''}
${jd ? `职位要求：\n${jd}\n` : ''}

面试对话记录：
${transcript}

请提供：
1. 对候选人回答的评分（1-10分）
2. 回答的优点
3. 需要改进的���方
4. 建议的追问方向`;
}

export function buildQuestionRecommendPrompt(resume, jd) {
  return `你是一位资深的技术面试官。请根据候选人简历和职位要求，推荐面试问题。

${resume ? `候选人简历摘要：\n${resume}\n` : ''}
${jd ? `职位要求：\n${jd}\n` : ''}

请推荐 5-8 个面试问题，包括：
- 2-3 个基础技术问题
- 2-3 个项目经验相关问题
- 1-2 个系统设计或架构问题

以 JSON 数组格式返回：
[{"question": "问题内容", "category": "分类", "difficulty": "easy/medium/hard"}]`;
}
