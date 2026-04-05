import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "child_process";
import OpenAI from "openai";
import { withRetry } from "../utils/retry";
import fs from "fs";
import os from "os";
import path from "path";
import { createLogger } from "../infra/logger";

type SttProvider = "openai" | "whisper-cpp";
const logger = createLogger("stt");

function getProvider(): SttProvider {
  const p = (process.env.stt_provider || "openai").toLowerCase();
  return p === "whisper-cpp" ? "whisper-cpp" : "openai";
}

type WhisperServerState = {
  proc: ChildProcess | null;
  startPromise: Promise<void> | null;
  failedUntil: number;
};

const whisperServerState: WhisperServerState = {
  proc: null,
  startPromise: null,
  failedUntil: 0,
};

function useWhisperServer(): boolean {
  const v = (process.env.whisper_use_server ?? process.env.WHISPER_USE_SERVER ?? "1").trim();
  return v !== "0" && v.toLowerCase() !== "false";
}

function whisperServerHost(): string {
  return (process.env.whisper_server_host || process.env.WHISPER_SERVER_HOST || "127.0.0.1").trim();
}

function whisperServerPort(): number {
  const raw = process.env.whisper_server_port || process.env.WHISPER_SERVER_PORT || "8080";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8080;
}

function whisperInferencePath(): string {
  const raw = (process.env.whisper_server_request_path || process.env.WHISPER_SERVER_REQUEST_PATH || "/inference").trim();
  if (!raw) return "/inference";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function whisperServerBaseUrl(): string {
  const raw = (process.env.whisper_server_url || process.env.WHISPER_SERVER_URL || "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  return `http://${whisperServerHost()}:${whisperServerPort()}`;
}

function whisperServerInferenceUrl(): string {
  return `${whisperServerBaseUrl()}${whisperInferencePath()}`;
}

function whisperServerAutostart(): boolean {
  const v = (process.env.whisper_server_autostart ?? process.env.WHISPER_SERVER_AUTOSTART ?? "1").trim();
  return v !== "0" && v.toLowerCase() !== "false";
}

function whisperServerCooldownMs(): number {
  const raw = process.env.whisper_server_retry_cooldown_ms || process.env.WHISPER_SERVER_RETRY_COOLDOWN_MS || "30000";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30_000;
}

function whisperServerReadyTimeoutMs(): number {
  const raw = process.env.whisper_server_ready_timeout_ms || process.env.WHISPER_SERVER_READY_TIMEOUT_MS || "5000";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 500 ? n : 5000;
}

function whisperServerRequestTimeoutMs(): number {
  const raw = process.env.whisper_server_request_timeout_ms || process.env.WHISPER_SERVER_REQUEST_TIMEOUT_MS || "8000";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1000 ? n : 8000;
}

function whisperPreviewEnabled(): boolean {
  const v = (process.env.stt_preview_enabled ?? process.env.STT_PREVIEW_ENABLED ?? "1").trim();
  return v !== "0" && v.toLowerCase() !== "false";
}

function buildWhisperServerArgs(): string[] {
  const model = process.env.whisper_model;
  if (!model) throw new Error("STT 未配置：请设置 whisper_model 指向 ggml 模型文件");
  const lang = process.env.whisper_lang || "zh";
  const args = [
    "-m", model,
    "-l", lang,
    "--host", whisperServerHost(),
    "--port", String(whisperServerPort()),
    "--inference-path", whisperInferencePath(),
    "--convert",
  ];
  const prompt = process.env.whisper_prompt;
  if (prompt) args.push("--prompt", prompt);
  const extra = process.env.whisper_server_extra_args || process.env.WHISPER_SERVER_EXTRA_ARGS;
  if (extra) args.push(...extra.split(/\s+/).filter(Boolean));
  return args;
}

async function waitWhisperServerReady(): Promise<void> {
  const deadline = Date.now() + whisperServerReadyTimeoutMs();
  const base = whisperServerBaseUrl();
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 800);
      const res = await fetch(base, { method: "GET", signal: controller.signal });
      clearTimeout(t);
      if (res.ok) return;
    } catch {
      // retry until timeout
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("whisper-server readiness timeout");
}

async function ensureWhisperServerReady(): Promise<boolean> {
  if (!useWhisperServer()) return false;
  if (!whisperServerAutostart()) return true;
  const now = Date.now();
  if (whisperServerState.failedUntil > now) return false;
  if (whisperServerState.proc && whisperServerState.proc.exitCode === null) return true;
  if (whisperServerState.startPromise) {
    try {
      await whisperServerState.startPromise;
      return true;
    } catch {
      return false;
    }
  }

  const cmd = process.env.whisper_server_cmd || process.env.WHISPER_SERVER_CMD || "whisper-server";
  const args = buildWhisperServerArgs();
  whisperServerState.startPromise = (async () => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    whisperServerState.proc = proc;

    let stderrTail = "";
    proc.stderr?.on("data", (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });
    proc.on("exit", (code, signal) => {
      whisperServerState.proc = null;
      if (code !== 0 && code !== null) {
        logger.warn("whisper-server exited", { code, signal });
      }
    });

    try {
      await waitWhisperServerReady();
      logger.info("whisper-server ready", { url: whisperServerInferenceUrl() });
    } catch (err) {
      try { proc.kill("SIGKILL"); } catch {}
      whisperServerState.proc = null;
      throw new Error(
        `whisper-server 启动失败: ${(err as Error).message}${stderrTail ? ` | ${stderrTail.slice(-300)}` : ""}`,
      );
    }
  })();

  try {
    await whisperServerState.startPromise;
    return true;
  } catch (err) {
    whisperServerState.failedUntil = Date.now() + whisperServerCooldownMs();
    logger.warn("whisper-server unavailable, fallback to whisper-cli", {
      error: (err as Error).message,
      cooldownMs: whisperServerCooldownMs(),
    });
    return false;
  } finally {
    whisperServerState.startPromise = null;
  }
}

export async function warmWhisperServer(): Promise<boolean> {
  if (getProvider() !== "whisper-cpp") return false;
  return ensureWhisperServerReady();
}

async function transcribeWithWhisperServer(wavPath: string, externalSignal?: AbortSignal): Promise<string> {
  const reqUrl = whisperServerInferenceUrl();
  const wav = fs.readFileSync(wavPath);
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), path.basename(wavPath));
  form.append("response_format", "json");
  const tempRaw = process.env.stt_temperature;
  if (tempRaw !== undefined && tempRaw !== "") form.append("temperature", String(tempRaw));
  const prompt = process.env.whisper_prompt;
  if (prompt) form.append("prompt", prompt);

  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), whisperServerRequestTimeoutMs());
  try {
    const res = await fetch(reqUrl, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    const bodyText = (await res.text()).trim();
    if (!bodyText) return "";
    try {
      const parsed = JSON.parse(bodyText) as { text?: string };
      return (parsed.text || "").trim();
    } catch {
      return bodyText.trim();
    }
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", abortFromExternal);
    }
  }
}

async function transcribePreviewWithWhisperServer(
  wavPath: string,
  externalSignal?: AbortSignal,
): Promise<string | null> {
  try {
    const ready = await ensureWhisperServerReady();
    if (!ready) return null;
    return await transcribeWithWhisperServer(wavPath, externalSignal);
  } catch (err) {
    logger.debug("whisper-server preview unavailable", {
      error: (err as Error).message,
    });
    return null;
  }
}

async function whisperTranscribePreferServer(
  wavPath: string,
  cliFallback: () => Promise<string>,
  externalSignal?: AbortSignal,
): Promise<string> {
  if (useWhisperServer()) {
    try {
      const ready = await ensureWhisperServerReady();
      if (ready) {
        return await transcribeWithWhisperServer(wavPath, externalSignal);
      }
    } catch (err) {
      logger.warn("whisper-server request failed, fallback to whisper-cli", {
        error: (err as Error).message,
      });
    }
  }
  return cliFallback();
}

export async function shutdownWhisperServer(): Promise<void> {
  const proc = whisperServerState.proc;
  whisperServerState.proc = null;
  whisperServerState.startPromise = null;
  whisperServerState.failedUntil = 0;
  if (!proc || proc.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      resolve();
    }, 1500);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try { proc.kill("SIGTERM"); } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

/**
 * Streaming STT that supports two input modes:
 *
 *   1. Legacy (WebM):  feed(chunk) → end()
 *   2. Full-duplex (PCM):  feedPcm(chunk) → endPcm()
 *
 * Events:
 *   "partial"  (status: string)
 *   "final"    (text: string)
 *   "error"    (err: Error)
 */
export class SttStream extends EventEmitter {
  /* ── WebM mode (legacy) ── */
  private chunks: Buffer[] = [];
  private totalBytes = 0;

  /* ── PCM mode (full-duplex) ── */
  private pcmChunks: Buffer[] = [];
  private pcmBytes = 0;
  private sampleRate = 16000;
  private previewAbort: AbortController | null = null;

  private client: OpenAI | null = null;

  constructor() {
    super();
    if (getProvider() === "openai") {
      const apiKey = process.env.stt_key;
      const baseURL = process.env.stt_base_url;
      if (apiKey && baseURL) {
        this.client = new OpenAI({ apiKey, baseURL, timeout: 30_000 });
      }
    }
  }

  get configured(): boolean {
    if (getProvider() === "whisper-cpp") return Boolean(process.env.whisper_model);
    return this.client !== null;
  }

  /* ======== WebM mode (backward-compat) ======== */

  feed(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;
    this.emit("partial", `录音中… ${(this.totalBytes / 1024).toFixed(0)} KB`);
  }

  async end(): Promise<string> {
    const audio = Buffer.concat(this.chunks);
    this.resetWebm();
    if (audio.length === 0) return "";

    const text =
      getProvider() === "whisper-cpp"
        ? await this.transcribeLocalWebm(audio)
        : await this.transcribeOpenAIWebm(audio);

    this.emit("final", text);
    return text;
  }

  /* ======== PCM mode (full-duplex) ======== */

  setSampleRate(rate: number): void {
    this.sampleRate = rate;
  }

  feedPcm(chunk: Buffer): void {
    this.pcmChunks.push(chunk);
    this.pcmBytes += chunk.length;

    const durationMs = (this.pcmBytes / 2 / this.sampleRate) * 1000;
    this.emit("partial", `录音中… ${(durationMs / 1000).toFixed(1)}s`);
  }

  /** Transcribe accumulated PCM and reset buffer. */
  async endPcm(): Promise<string> {
    this.cancelPreview();
    const pcm = Buffer.concat(this.pcmChunks);
    this.resetPcm();
    if (pcm.length < minimumPcmBytes(this.sampleRate)) return "";

    const wav = pcmToWav(pcm, this.sampleRate);
    const text =
      getProvider() === "whisper-cpp"
        ? await this.transcribeLocalWav(wav)
        : await this.transcribeOpenAIWav(wav);

    this.emit("final", text);
    return text;
  }

  /** Discard accumulated PCM without transcribing. */
  cancelPcm(): void {
    this.resetPcm();
  }

  cancelPreview(): void {
    if (!this.previewAbort) return;
    try {
      this.previewAbort.abort();
    } catch {
      // best effort
    }
    this.previewAbort = null;
  }

  get pcmDurationMs(): number {
    return (this.pcmBytes / 2 / this.sampleRate) * 1000;
  }

  canPreviewPcm(): boolean {
    if (!whisperPreviewEnabled()) return false;
    if (getProvider() !== "whisper-cpp") return false;
    return useWhisperServer();
  }

  /**
   * Preview transcription from current PCM buffer without consuming/resetting it.
   * Returns null when preview is unavailable (provider/path not supported).
   */
  async previewPcm(maxWindowMs?: number): Promise<string | null> {
    if (!this.canPreviewPcm()) return null;
    const pcm = this.snapshotPcm(maxWindowMs);
    if (pcm.length < this.sampleRate) return "";
    const wav = pcmToWav(pcm, this.sampleRate);
    return this.transcribeLocalWavPreview(wav, this.sampleRate);
  }

  /**
   * Preview transcription from a caller-provided PCM snapshot.
   * Does not mutate internal PCM buffer used by endPcm().
   */
  async previewPcmBuffer(pcm: Buffer, sampleRate: number, maxWindowMs?: number): Promise<string | null> {
    if (!this.canPreviewPcm()) return null;
    const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.floor(sampleRate) : this.sampleRate;
    const sliced = this.slicePcmWindow(pcm, rate, maxWindowMs);
    if (sliced.length < rate) return "";
    const wav = pcmToWav(sliced, rate);
    return this.transcribeLocalWavPreview(wav, rate);
  }

  /* ======== Transcription backends ======== */

  /** Only adds language / temperature / prompt when env is set — matches original minimal API body and avoids breaking some OpenAI-compatible providers. */
  private openAiTranscriptionBody(): {
    model: string;
    language?: string;
    temperature?: number;
    prompt?: string;
  } {
    const prompt = process.env.whisper_prompt || process.env.stt_prompt;
    const lang = process.env.stt_language || process.env.whisper_lang;
    const tempRaw = process.env.stt_temperature;

    const body: {
      model: string;
      language?: string;
      temperature?: number;
      prompt?: string;
    } = {
      model: process.env.stt_model || "whisper-1",
    };

    if (lang) body.language = lang;
    if (prompt) body.prompt = prompt;
    if (tempRaw !== undefined && tempRaw !== "") {
      const t = Math.min(1, Math.max(0, Number(tempRaw)));
      if (Number.isFinite(t)) body.temperature = t;
    }

    return body;
  }

  // -- OpenAI, WebM input --
  private async transcribeOpenAIWebm(audio: Buffer): Promise<string> {
    if (!this.client) throw new Error("STT 未配置：请设置 stt_key 和 stt_base_url");

    const tmp = tmpPath("webm");
    fs.writeFileSync(tmp, audio);
    try {
      const res = await withRetry(
        () =>
          this.client!.audio.transcriptions.create({
            file: fs.createReadStream(tmp),
            ...this.openAiTranscriptionBody(),
          }),
        { retries: 1 },
      );
      return res.text;
    } finally {
      fs.unlinkSync(tmp);
    }
  }

  // -- OpenAI, WAV input --
  private async transcribeOpenAIWav(wav: Buffer): Promise<string> {
    if (!this.client) throw new Error("STT 未配置：请设置 stt_key 和 stt_base_url");

    const tmp = tmpPath("wav");
    fs.writeFileSync(tmp, wav);
    try {
      const res = await withRetry(
        () =>
          this.client!.audio.transcriptions.create({
            file: fs.createReadStream(tmp),
            ...this.openAiTranscriptionBody(),
          }),
        { retries: 1 },
      );
      return res.text;
    } finally {
      fs.unlinkSync(tmp);
    }
  }

  // -- Local whisper-cpp, WebM input (needs ffmpeg) --
  private async transcribeLocalWebm(audio: Buffer): Promise<string> {
    const model = process.env.whisper_model;
    if (!model) throw new Error("STT 未配置：请设置 whisper_model 指向 ggml 模型文件");

    const webm = tmpPath("webm");
    const wav = tmpPath("wav");
    fs.writeFileSync(webm, audio);

    try {
      await run("ffmpeg", [
        "-i", webm,
        "-ar", "16000", "-ac", "1", "-f", "wav", wav,
        "-y", "-loglevel", "error",
      ]);
      return await whisperTranscribePreferServer(
        wav,
        () => this.whisperTranscribe(wav),
      );
    } finally {
      try { fs.unlinkSync(webm); } catch {}
      try { fs.unlinkSync(wav); } catch {}
    }
  }

  // -- Local whisper-cpp, WAV input (already PCM, may need resample) --
  private async transcribeLocalWav(wav: Buffer): Promise<string> {
    const model = process.env.whisper_model;
    if (!model) throw new Error("STT 未配置：请设置 whisper_model 指向 ggml 模型文件");

    const wavPath = tmpPath("wav");
    fs.writeFileSync(wavPath, wav);

    if (this.sampleRate !== 16000) {
      const resampled = tmpPath("wav");
      try {
        await run("ffmpeg", [
          "-i", wavPath,
          "-ar", "16000", "-ac", "1", "-f", "wav", resampled,
          "-y", "-loglevel", "error",
        ]);
        fs.unlinkSync(wavPath);
        const text = await whisperTranscribePreferServer(
          resampled,
          () => this.whisperTranscribe(resampled),
          undefined,
        );
        fs.unlinkSync(resampled);
        return text;
      } catch (e) {
        try { fs.unlinkSync(resampled); } catch {}
        throw e;
      }
    }

    try {
      return await whisperTranscribePreferServer(
        wavPath,
        () => this.whisperTranscribe(wavPath),
        undefined,
      );
    } finally {
      try { fs.unlinkSync(wavPath); } catch {}
    }
  }

  // -- Local whisper-cpp preview path (server-only, no cli fallback) --
  private async transcribeLocalWavPreview(wav: Buffer, sourceRate: number): Promise<string | null> {
    const model = process.env.whisper_model;
    if (!model) return null;
    this.cancelPreview();
    const previewAbort = new AbortController();
    this.previewAbort = previewAbort;
    const wavPath = tmpPath("wav");
    fs.writeFileSync(wavPath, wav);
    try {
      if (sourceRate !== 16000) {
        const resampled = tmpPath("wav");
        try {
          await run("ffmpeg", [
            "-i", wavPath,
            "-ar", "16000", "-ac", "1", "-f", "wav", resampled,
            "-y", "-loglevel", "error",
          ]);
          fs.unlinkSync(wavPath);
          const text = await transcribePreviewWithWhisperServer(resampled, previewAbort.signal);
          fs.unlinkSync(resampled);
          return text;
        } catch {
          try { fs.unlinkSync(resampled); } catch {}
          return null;
        }
      }
      return await transcribePreviewWithWhisperServer(wavPath, previewAbort.signal);
    } finally {
      if (this.previewAbort === previewAbort) {
        this.previewAbort = null;
      }
      try { fs.unlinkSync(wavPath); } catch {}
    }
  }

  private async whisperTranscribe(wavPath: string): Promise<string> {
    const cmd = process.env.whisper_cmd || "whisper-cli";
    const lang = process.env.whisper_lang || "zh";
    const model = process.env.whisper_model!;

    const args = [
      "-m", model,
      "-f", wavPath,
      "-l", lang,
      "--no-timestamps",
    ];

    const prompt = process.env.whisper_prompt;
    if (prompt) {
      args.push("--prompt", prompt);
    }

    const extraArgs = process.env.whisper_extra_args;
    if (extraArgs) {
      args.push(...extraArgs.split(/\s+/).filter(Boolean));
    }

    let raw: string;
    try {
      raw = await run(cmd, args);
    } catch {
      await new Promise((r) => setTimeout(r, 350));
      raw = await run(cmd, args);
    }

    return raw
      .replace(/^\[.*?\]\s*/gm, "")
      .replace(/\[BLANK_AUDIO\]/g, "")
      .trim();
  }

  /* ======== Helpers ======== */

  private resetWebm(): void {
    this.chunks = [];
    this.totalBytes = 0;
  }

  private resetPcm(): void {
    this.pcmChunks = [];
    this.pcmBytes = 0;
  }

  private snapshotPcm(maxWindowMs?: number): Buffer {
    if (this.pcmChunks.length === 0) return Buffer.alloc(0);
    const all = Buffer.concat(this.pcmChunks);
    return this.slicePcmWindow(all, this.sampleRate, maxWindowMs);
  }

  private slicePcmWindow(pcm: Buffer, sampleRate: number, maxWindowMs?: number): Buffer {
    if (pcm.length === 0) return pcm;
    const windowMs = Number.isFinite(maxWindowMs) && (maxWindowMs as number) > 0
      ? (maxWindowMs as number)
      : 0;
    if (windowMs <= 0) return pcm;
    const keepBytes = Math.floor((sampleRate * 2 * windowMs) / 1000);
    if (keepBytes <= 0 || pcm.length <= keepBytes) return pcm;
    return pcm.subarray(pcm.length - keepBytes);
  }

  reset(): void {
    this.cancelPreview();
    this.resetWebm();
    this.resetPcm();
  }
}

/* ── Utilities ── */

function tmpPath(ext: string): string {
  return path.join(
    os.tmpdir(),
    `rem-stt-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
  );
}

function minimumPcmBytes(sampleRate: number): number {
  const raw = process.env.stt_min_pcm_ms || process.env.STT_MIN_PCM_MS || process.env.VAD_MIN_UTTERANCE_MS || "220";
  const ms = Number(raw);
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 220;
  return Math.ceil(sampleRate * 2 * safeMs / 1000);
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) =>
      reject(new Error(`${cmd} 启动失败: ${err.message}`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${cmd} 退出码 ${code}`));
    });
  });
}

/** Wrap raw PCM (16-bit LE mono) in a WAV container. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcm.length;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);            // fmt chunk size
  header.writeUInt16LE(1, 20);             // PCM
  header.writeUInt16LE(1, 22);             // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);             // block align
  header.writeUInt16LE(16, 34);            // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, pcm]);
}
