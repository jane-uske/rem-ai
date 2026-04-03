import OpenAI from "openai";
import { spawn, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { EdgeTTS } from "node-edge-tts";
import { getEmotionVoiceParams, type Emotion } from "./tts_emotion";

let client: OpenAI | null = null;
let warnedTtsDisabled = false;

type TtsProvider = "openai" | "piper" | "edge";

function getProvider(): TtsProvider {
  const p = (process.env.tts_provider || "edge").toLowerCase();
  if (p === "piper") return "piper";
  if (p === "openai") return "openai";
  return "edge";
}

function getClient(): OpenAI | null {
  if (client) return client;
  const apiKey = process.env.tts_key;
  const baseURL = process.env.tts_base_url;
  if (!apiKey || !baseURL) return null;
  client = new OpenAI({ apiKey, baseURL, timeout: 15_000 });
  return client;
}

function getPiperCommand(): string {
  return process.env.piper_cmd || "piper";
}

function getPiperModel(): string | null {
  return process.env.piper_model || null;
}

function normalizeTtsText(raw: string): string {
  const maxChars = Number(process.env.tts_max_chars || 120);
  const clean = raw
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "嗯。";
  if (clean.length <= maxChars) return clean;

  const cut = clean.slice(0, maxChars);
  const lastPunc = Math.max(
    cut.lastIndexOf("。"),
    cut.lastIndexOf("！"),
    cut.lastIndexOf("？"),
    cut.lastIndexOf("."),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("?"),
    cut.lastIndexOf("，"),
    cut.lastIndexOf(","),
  );
  if (lastPunc >= 16) return cut.slice(0, lastPunc + 1);
  return `${cut}。`;
}

export function isTtsEnabled(): boolean {
  const provider = getProvider();
  if (provider === "edge") return true;
  if (provider === "piper") return Boolean(getPiperModel());
  return Boolean(process.env.tts_key && process.env.tts_base_url);
}

function warnTtsDisabledOnce(provider: TtsProvider): void {
  if (warnedTtsDisabled) return;
  warnedTtsDisabled = true;
  if (provider === "piper") {
    console.warn("[TTS] 已禁用：tts_provider=piper 但未配置 piper_model");
    return;
  }
  console.warn("[TTS] 已禁用：请配置 tts_key 和 tts_base_url，或切到 tts_provider=edge");
}

/* ── Abort helpers ── */

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("TTS aborted", "AbortError");
}

function onAbort(signal: AbortSignal | undefined, fn: () => void): () => void {
  if (!signal) return () => {};
  signal.addEventListener("abort", fn, { once: true });
  return () => signal.removeEventListener("abort", fn);
}

/* ── Providers ── */

async function speakWithOpenAI(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  const openai = getClient();
  if (!openai) {
    throw new Error("TTS 未配置：请在 .env 中设置 tts_key 和 tts_base_url");
  }

  const model = process.env.tts_model || "tts-1";
  const voice = process.env.tts_voice || "alloy";
  const { speed } = getEmotionVoiceParams(emotion ?? "neutral");

  const response = await openai.audio.speech.create(
    { model, voice: voice as "alloy", input: text, speed },
  );

  throwIfAborted(signal);
  const arrayBuffer = await response.arrayBuffer();
  throwIfAborted(signal);
  return Buffer.from(arrayBuffer);
}

const PIPER_TIMEOUT_MS = Number(process.env.piper_timeout || 10_000);

async function speakWithPiper(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  const model = getPiperModel();
  if (!model) throw new Error("TTS 未配置：请在 .env 中设置 piper_model");

  const outFile = path.join(
    os.tmpdir(),
    `rem-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
  );
  const cmd = getPiperCommand();
  const speaker = process.env.piper_speaker;
  const ev = getEmotionVoiceParams(emotion ?? "neutral");
  const lengthScale = process.env.piper_length_scale || String(ev.lengthScale);
  const noiseScale = process.env.piper_noise_scale || String(ev.noiseScale);
  const noiseW = process.env.piper_noise_w_scale;

  const args = ["--model", model, "--output_file", outFile];
  if (speaker) args.push("--speaker", speaker);
  args.push("--length_scale", lengthScale);
  args.push("--noise_scale", noiseScale);
  if (noiseW) args.push("--noise_w", noiseW);

  const t0 = Date.now();

  await new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      if (err) reject(err); else resolve();
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`piper 超时 (${PIPER_TIMEOUT_MS}ms)`));
    }, PIPER_TIMEOUT_MS);

    const cleanup = onAbort(signal, () => {
      child.kill("SIGKILL");
      finish(new DOMException("TTS aborted", "AbortError"));
    });

    child.stderr!.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err) => finish(err));
    child.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(stderr || `piper 退出码: ${code}`));
    });

    child.stdin!.write(text.trim());
    child.stdin!.end();
  });

  console.log(`[TTS] piper ${Date.now() - t0}ms "${text.slice(0, 30)}…"`);

  try {
    return await fs.readFile(outFile);
  } finally {
    await fs.unlink(outFile).catch(() => {});
  }
}

let edgeInstance: InstanceType<typeof EdgeTTS> | null = null;

function getEdgeTTS(): InstanceType<typeof EdgeTTS> {
  if (edgeInstance) return edgeInstance;
  edgeInstance = new EdgeTTS({
    voice: process.env.tts_voice || "zh-CN-XiaoxiaoNeural",
    lang: process.env.tts_lang || "zh-CN",
    rate: process.env.tts_rate || "default",
    outputFormat: "audio-24khz-48kbitrate-mono-mp3",
    timeout: 15_000,
  });
  return edgeInstance;
}

async function speakWithEdge(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  const tmpFile = path.join(
    os.tmpdir(),
    `rem-edge-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`,
  );
  const t0 = Date.now();
  try {
    throwIfAborted(signal);
    const resolved = emotion ?? "neutral";
    let edge: InstanceType<typeof EdgeTTS>;
    if (resolved === "neutral") {
      edge = getEdgeTTS();
    } else {
      const { rate, pitch } = getEmotionVoiceParams(resolved);
      edge = new EdgeTTS({
        voice: process.env.tts_voice || "zh-CN-XiaoxiaoNeural",
        lang: process.env.tts_lang || "zh-CN",
        rate,
        pitch,
        outputFormat: "audio-24khz-48kbitrate-mono-mp3",
        timeout: 15_000,
      });
    }
    await edge.ttsPromise(text, tmpFile);
    throwIfAborted(signal);
    console.log(`[TTS] edge ${Date.now() - t0}ms "${text.slice(0, 30)}…"`);
    return await fs.readFile(tmpFile);
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

/* ── Public API ── */

export async function textToSpeech(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  throwIfAborted(signal);
  const ttsText = normalizeTtsText(text);
  const provider = getProvider();
  if (!isTtsEnabled()) {
    warnTtsDisabledOnce(provider);
    throw new Error("TTS_DISABLED");
  }

  if (provider === "edge") return speakWithEdge(ttsText, signal, emotion);
  if (provider === "piper") return speakWithPiper(ttsText, signal, emotion);
  return speakWithOpenAI(ttsText, signal, emotion);
}
