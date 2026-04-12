import OpenAI from "openai";

export const EMBEDDING_DIMENSIONS = 768;

let client: OpenAI | null = null;

function getEmbeddingConfig(): {
  apiKey: string;
  baseURL: string;
  model: string;
} {
  const baseURL = process.env.REM_EMBEDDING_BASE_URL?.trim();
  const apiKey = process.env.REM_EMBEDDING_API_KEY?.trim();
  const model = process.env.REM_EMBEDDING_MODEL?.trim() || "nomic-embed-text";

  if (!baseURL) {
    throw new Error("Embedding client is not configured: missing REM_EMBEDDING_BASE_URL");
  }
  if (!apiKey) {
    throw new Error("Embedding client is not configured: missing REM_EMBEDDING_API_KEY");
  }

  return { apiKey, baseURL, model };
}

function getClient(): {
  client: OpenAI;
  model: string;
} {
  const { apiKey, baseURL, model } = getEmbeddingConfig();
  if (!client) {
    client = new OpenAI({ apiKey, baseURL });
  }
  return { client, model };
}

export async function embed(text: string): Promise<number[]> {
  const { client: openai, model } = getClient();
  const response = await openai.embeddings.create({
    model,
    input: text,
  });
  return response.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    embeddings.push(await embed(text));
  }
  return embeddings;
}
