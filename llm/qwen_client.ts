import OpenAI from "openai";
import { withRetry } from "../utils/retry";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.key;
  const baseURL = process.env.base_url;
  if (!apiKey || !baseURL) throw new Error("LLM 未配置：缺少 key / base_url");
  client = new OpenAI({ apiKey, baseURL });
  return client;
}

/**
 * Non-streaming completion. Used by Slow Brain for background analysis.
 * Returns the full text with <think> blocks stripped.
 */
export async function complete(
  messages: ChatMessage[],
  maxTokens = 512,
): Promise<string> {
  const openai = getClient();
  const model = process.env.model;
  if (!model) throw new Error("LLM 未配置：缺少 model");

  const res = await withRetry(
    () =>
      openai.chat.completions.create({
        model,
        messages,
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
    { retries: 1, label: "complete" },
  );

  const raw = res.choices?.[0]?.message?.content ?? "";
  return raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Stream tokens from the LLM, automatically filtering <think>...</think> blocks.
 * Accepts an optional AbortSignal to cancel mid-stream.
 */
export async function* streamTokens(
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const openai = getClient();
  const model = process.env.model;
  if (!model) throw new Error("LLM 未配置：缺少 model");

  const stream = (await withRetry(
    () =>
      (openai.chat.completions.create as Function)({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 1024,
        stream: true,
      }),
    { retries: 1, label: "streamTokens" },
  )) as AsyncIterable<{ choices?: { delta?: { content?: string } }[] }>;

  let inThink = false;
  let buf = "";

  for await (const chunk of stream) {
    if (signal?.aborted) break;

    const text = chunk.choices?.[0]?.delta?.content;
    if (!text) continue;

    buf += text;
    let out = "";

    while (buf) {
      if (inThink) {
        const end = buf.indexOf("</think>");
        if (end === -1) {
          buf = buf.length > 8 ? buf.slice(-8) : buf;
          break;
        }
        buf = buf.slice(end + 8);
        inThink = false;
      } else {
        const start = buf.indexOf("<think>");
        if (start !== -1) {
          out += buf.slice(0, start);
          buf = buf.slice(start + 7);
          inThink = true;
        } else {
          let cutoff = buf.length;
          for (let i = 1; i < 7; i++) {
            if (buf.endsWith("<think>".slice(0, i))) {
              cutoff = buf.length - i;
              break;
            }
          }
          out += buf.slice(0, cutoff);
          buf = buf.slice(cutoff);
          break;
        }
      }
    }

    if (out) yield out;
  }

  if (!inThink && buf && !signal?.aborted) yield buf;
}
