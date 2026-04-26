import OpenAI from 'openai';

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.LLM_API_KEY || '';
    const baseURL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
    console.log('[AI] Creating OpenAI client, baseURL:', baseURL, 'apiKey:', apiKey ? apiKey.substring(0, 8) + '...' : 'EMPTY');
    client = new OpenAI({ apiKey, baseURL });
  }
  return client;
}

export default getClient;

export async function streamChat(messages, model) {
  return getClient().chat.completions.create({
    model: model || process.env.MAIN_MODEL || 'vtrix-gemini-3-flash-preview',
    messages,
    stream: true,
    max_tokens: 2048,
  });
}

export async function queryChat(messages, model) {
  const useModel = model || process.env.FAST_MODEL || 'vtrix-gemini-3-flash-preview';
  console.log('[AI] queryChat model:', useModel);
  const response = await getClient().chat.completions.create({
    model: useModel,
    messages,
    max_tokens: 1024,
  });
  return response.choices[0]?.message?.content || '';
}

export async function generateEmbedding(text) {
  const response = await getClient().embeddings.create({
    model: 'text-embedding-3-large',
    input: text,
  });
  return response.data[0].embedding;
}
