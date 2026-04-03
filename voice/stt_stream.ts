import { EventEmitter } from "events";
import { spawn } from "child_process";
import OpenAI from "openai";
import fs from "fs";
import os from "os";
import path from "path";

type SttProvider = "openai" | "whisper-cpp";

function getProvider(): SttProvider {
  const p = (process.env.stt_provider || "openai").toLowerCase();
  return p === "whisper-cpp" ? "whisper-cpp" : "openai";
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
    const pcm = Buffer.concat(this.pcmChunks);
    this.resetPcm();
    if (pcm.length < this.sampleRate) return ""; // < 0.5 s — too short

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

  get pcmDurationMs(): number {
    return (this.pcmBytes / 2 / this.sampleRate) * 1000;
  }

  /* ======== Transcription backends ======== */

  // -- OpenAI, WebM input --
  private async transcribeOpenAIWebm(audio: Buffer): Promise<string> {
    if (!this.client) throw new Error("STT 未配置：请设置 stt_key 和 stt_base_url");

    const tmp = tmpPath("webm");
    fs.writeFileSync(tmp, audio);
    try {
      const res = await this.client.audio.transcriptions.create({
        model: process.env.stt_model || "whisper-1",
        file: fs.createReadStream(tmp),
      });
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
      const res = await this.client.audio.transcriptions.create({
        model: process.env.stt_model || "whisper-1",
        file: fs.createReadStream(tmp),
      });
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
      return await this.whisperTranscribe(wav);
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
        const text = await this.whisperTranscribe(resampled);
        fs.unlinkSync(resampled);
        return text;
      } catch (e) {
        try { fs.unlinkSync(resampled); } catch {}
        throw e;
      }
    }

    try {
      return await this.whisperTranscribe(wavPath);
    } finally {
      try { fs.unlinkSync(wavPath); } catch {}
    }
  }

  private async whisperTranscribe(wavPath: string): Promise<string> {
    const cmd = process.env.whisper_cmd || "whisper-cli";
    const lang = process.env.whisper_lang || "zh";
    const model = process.env.whisper_model!;

    const raw = await run(cmd, [
      "-m", model,
      "-f", wavPath,
      "-l", lang,
      "--no-timestamps",
    ]);

    return raw.replace(/^\[.*?\]\s*/gm, "").trim();
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

  reset(): void {
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
