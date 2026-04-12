import OpenAI from "openai";
import { createLogger } from "../infra/logger";

const logger = createLogger("embeddings");

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (client) return client;
  const apiKey = process.env.key;
  const baseURL = process.env.base_url;
  if (!apiKey || !baseURL) return null;
  client = new OpenAI({ apiKey, baseURL });
  return client;
}

export function embeddingEnabled(): boolean {
  return Boolean(process.env.EMBEDDING_MODEL?.trim());
}

/**
 * Generate a dense embedding vector for the given text.
 * Returns null when embedding is not configured or the API call fails.
 * Callers should treat null as "fall back to keyword recall".
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!embeddingEnabled()) return null;
  const model = process.env.EMBEDDING_MODEL!.trim();
  const openai = getClient();
  if (!openai) return null;

  try {
    const res = await openai.embeddings.create({
      model,
      input: text.slice(0, 8192),
    });
    return res.data[0]?.embedding ?? null;
  } catch (err) {
    logger.warn("[Embedding] 生成失败，降级为关键词召回", {
      error: (err as Error).message,
    });
    return null;
  }
}
