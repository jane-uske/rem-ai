import { EventEmitter } from "events";

export interface VadOptions {
  /** RMS energy threshold (0–1 for 16-bit PCM). Default: 0.012 */
  energyThreshold?: number;
  /** Consecutive silent frames before speech_end. Default: 14 (~700 ms at 50 ms chunks) */
  silenceFrames?: number;
  /** Minimum speech frames before triggering speech_start. Default: 3 (~150 ms) */
  minSpeechFrames?: number;
}

/**
 * Energy-based Voice Activity Detector for 16-bit LE mono PCM.
 *
 * Events:
 *   "speech_start"  — user began speaking
 *   "speech_end"    — user stopped speaking (after sustained silence)
 */
export class VadDetector extends EventEmitter {
  private threshold: number;
  private silenceLimit: number;
  private minSpeech: number;

  private _speaking = false;
  private speechCount = 0;
  private silentCount = 0;

  constructor(opts: VadOptions = {}) {
    super();
    this.threshold = opts.energyThreshold ?? 0.012;
    this.silenceLimit = opts.silenceFrames ?? 14;
    this.minSpeech = opts.minSpeechFrames ?? 3;
  }

  get speaking(): boolean {
    return this._speaking;
  }

  /** Feed a 16-bit LE mono PCM chunk from the client. */
  feed(pcm: Buffer): void {
    const energy = rms(pcm);
    const loud = energy > this.threshold;

    if (loud) {
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
      this.speechCount = 0;
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
