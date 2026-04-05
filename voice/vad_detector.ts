import { EventEmitter } from "events";

export interface VadOptions {
  /** RMS energy threshold (0–1 for 16-bit PCM). Default: ~0.06 */
  energyThreshold?: number;
  /** Consecutive silent frames before speech_end. Default: 6 (~300 ms if each client chunk ≈50 ms) */
  silenceFrames?: number;
  /** Minimum speech frames before triggering speech_start. Default: 3 (~150 ms at 50 ms chunks) */
  minSpeechFrames?: number;
  /**
   * Max zero-crossing rate (0–1) for a frame to count as speech.
   * Keyboard clicks typically have ZCR >0.5; Chinese speech (including
   * sibilants like sh/zh/s/c) can reach ~0.45.
   * Default: 0.45
   */
  maxZcr?: number;
  /**
   * Max peak/RMS ratio (crest factor) for a frame to count as speech.
   * Impulsive noise (keyboard, mouse) is spike-dominated → crest often 30+.
   * Sustained speech in a frame is typically under 22.
   * Default: 22
   */
  maxCrest?: number;
}

/**
 * Energy + ZCR Voice Activity Detector for 16-bit LE mono PCM.
 *
 * Uses RMS energy AND zero-crossing rate to distinguish speech from
 * transient noise (keyboard clicks, mouse clicks, etc.).
 *
 * speechCount decays gradually (−1 per non-speech frame) instead of
 * hard-resetting, so occasional sibilant frames don't break the chain.
 *
 * Events:
 *   "speech_start"  — user began speaking
 *   "speech_end"    — user stopped speaking (after sustained silence)
 */
export class VadDetector extends EventEmitter {
  private threshold: number;
  private silenceLimit: number;
  private minSpeech: number;
  private maxZcr: number;
  private maxCrest: number;

  private _speaking = false;
  private speechCount = 0;
  private silentCount = 0;

  constructor(opts: VadOptions = {}) {
    super();
    const envThreshold = process.env.VAD_THRESHOLD ? Number(process.env.VAD_THRESHOLD) : undefined;
    const envMinSpeech = process.env.VAD_MIN_SPEECH_FRAMES ? Number(process.env.VAD_MIN_SPEECH_FRAMES) : undefined;
    const envSilenceFrames = process.env.VAD_SILENCE_FRAMES ? Number(process.env.VAD_SILENCE_FRAMES) : undefined;
    const envMaxZcr = process.env.VAD_MAX_ZCR ? Number(process.env.VAD_MAX_ZCR) : undefined;
    const envMaxCrest = process.env.VAD_MAX_CREST ? Number(process.env.VAD_MAX_CREST) : undefined;
    // Balance: too high → mic never crosses threshold (no reaction); too low
    // → false triggers. Tune with VAD_THRESHOLD / VAD_MIN_SPEECH_FRAMES.
    this.threshold = opts.energyThreshold ?? envThreshold ?? 0.06;
    this.silenceLimit = opts.silenceFrames ?? envSilenceFrames ?? 6;
    this.minSpeech = opts.minSpeechFrames ?? envMinSpeech ?? 3;
    this.maxZcr = opts.maxZcr ?? envMaxZcr ?? 0.45;
    this.maxCrest = opts.maxCrest ?? envMaxCrest ?? 22;
  }

  get speaking(): boolean {
    return this._speaking;
  }

  /**
   * Feed a 16-bit LE mono PCM chunk from the client.
   * A frame counts as "speech" only when energy exceeds the threshold,
   * zero-crossing rate is below maxZcr, and crest factor is below maxCrest
   * (keyboard/mouse clicks are impulsive → very high peak/RMS).
   */
  feed(pcm: Buffer): void {
    const energy = rms(pcm);
    const zcr = zeroCrossingRate(pcm);
    const crest = crestFactor(pcm);
    const isSpeech =
      energy > this.threshold && zcr < this.maxZcr && crest < this.maxCrest;

    if (isSpeech) {
      this.silentCount = 0;
      this.speechCount++;

      if (!this._speaking && this.speechCount >= this.minSpeech) {
        this._speaking = true;
        this.emit("speech_start");
      }
    } else if (this._speaking) {
      this.silentCount++;
      if (this.silentCount >= this.silenceLimit) {
        this._speaking = false;
        this.speechCount = 0;
        this.silentCount = 0;
        this.emit("speech_end");
      }
    } else {
      // Gradual decay instead of hard reset — tolerates occasional
      // sibilant/unvoiced frames (high ZCR) during speech onset.
      this.speechCount = Math.max(0, this.speechCount - 1);
    }
  }

  reset(): void {
    this._speaking = false;
    this.speechCount = 0;
    this.silentCount = 0;
  }
}

/** Root-mean-square of 16-bit LE PCM samples, normalised to 0–1. */
function rms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length - 1; i += 2) {
    const s = pcm.readInt16LE(i) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

/**
 * Zero-crossing rate of 16-bit LE PCM, normalised to 0–1.
 * High values (>0.5) indicate impulsive noise; speech is typically <0.45.
 */
function zeroCrossingRate(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n < 2) return 0;
  let crossings = 0;
  let prev = pcm.readInt16LE(0);
  for (let i = 2; i < pcm.length - 1; i += 2) {
    const cur = pcm.readInt16LE(i);
    if ((prev >= 0 && cur < 0) || (prev < 0 && cur >= 0)) crossings++;
    prev = cur;
  }
  return crossings / (n - 1);
}

/** Peak / RMS — impulsive keyboard/mouse clicks in a mostly-quiet frame → very high. */
function crestFactor(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return 1;
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < pcm.length - 1; i += 2) {
    const s = pcm.readInt16LE(i) / 32768;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / n);
  if (rms < 1e-9) return 1;
  return peak / rms;
}
