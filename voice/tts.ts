import OpenAI from "openai";
import { spawn, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { WebSocket } from "ws";
import { randomBytes } from "crypto";
import { getEmotionVoiceParams, type Emotion } from "./tts_emotion";
import { createLogger } from "../infra/logger";

const logger = createLogger("tts");

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
    logger.warn("已禁用：tts_provider=piper 但未配置 piper_model");
    return;
  }
  logger.warn("已禁用：请配置 tts_key 和 tts_base_url，或切到 tts_provider=edge");
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

  logger.info("piper 合成完成", { duration: Date.now() - t0, text: text.slice(0, 30) });

  try {
    return await fs.readFile(outFile);
  } finally {
    await fs.unlink(outFile).catch(() => {});
  }
}

/* ── Edge TTS (in-memory, no disk I/O) ── */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const edgeDrm = require("node-edge-tts/dist/drm");
const EDGE_CHROMIUM_VER: string = edgeDrm.CHROMIUM_FULL_VERSION;
const EDGE_TOKEN: string = edgeDrm.TRUSTED_CLIENT_TOKEN;
const EDGE_TIMEOUT_MS = Number(process.env.edge_tts_timeout || 10_000);

function edgeGecToken(): string {
  return edgeDrm.generateSecMsGecToken();
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&apos;";
      default: return c;
    }
  });
}

function edgeTtsBuffer(
  text: string,
  voice: string,
  lang: string,
  rate: string,
  pitch: string,
  outputFormat: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("TTS aborted", "AbortError"));
      return;
    }

    const majorVer = EDGE_CHROMIUM_VER.split(".")[0];
    const ws = new WebSocket(
      `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TOKEN}&Sec-MS-GEC=${edgeGecToken()}&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM_VER}`,
      {
        headers: {
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
          "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVer}.0.0.0 Safari/537.36 Edg/${majorVer}.0.0.0`,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en-US,en;q=0.9",
          Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        },
      },
    );

    const chunks: Buffer[] = [];
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortHandler);
      try { ws.close(); } catch {}
      if (err) reject(err);
      else resolve(Buffer.concat(chunks));
    };

    const timer = setTimeout(() => {
      finish(new Error(`Edge TTS 超时 (${EDGE_TIMEOUT_MS}ms)`));
    }, EDGE_TIMEOUT_MS);

    const abortHandler = () => finish(new DOMException("TTS aborted", "AbortError"));
    if (signal) signal.addEventListener("abort", abortHandler, { once: true });

    ws.on("open", () => {
      ws.send(
        `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"${outputFormat}"}}}}`,
      );
      const reqId = randomBytes(16).toString("hex");
      ws.send(
        `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">` +
        `<voice name="${voice}"><prosody rate="${rate}" pitch="${pitch}">${escapeXml(text)}</prosody></voice></speak>`,
      );
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (done) return;
      if (isBinary) {
        const sep = "Path:audio\r\n";
        const idx = data.indexOf(sep);
        if (idx >= 0) chunks.push(data.subarray(idx + sep.length));
      } else {
        if (data.toString().includes("Path:turn.end")) finish();
      }
    });

    ws.on("error", (err) => finish(err));
    ws.on("close", () => {
      if (!done) finish(new Error("Edge TTS WebSocket 意外关闭"));
    });
  });
}

async function speakWithEdge(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  throwIfAborted(signal);
  const t0 = Date.now();

  const voice = process.env.tts_voice || "zh-CN-XiaoyiNeural";
  const lang = process.env.tts_lang || "zh-CN";
  const fmt = "audio-24khz-48kbitrate-mono-mp3";

  const resolved = emotion ?? "neutral";
  let rate: string;
  let pitch: string;
  if (resolved === "neutral") {
    rate = process.env.tts_rate || "default";
    pitch = process.env.tts_pitch || "default";
  } else {
    const ev = getEmotionVoiceParams(resolved);
    rate = ev.rate;
    pitch = ev.pitch;
  }

  const buf = await edgeTtsBuffer(text, voice, lang, rate, pitch, fmt, signal);
  logger.info("edge 合成完成", { duration: Date.now() - t0, text: text.slice(0, 30) });
  return buf;
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
