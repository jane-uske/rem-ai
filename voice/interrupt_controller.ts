import { EventEmitter } from "events";

export type PipelineState = "idle" | "generating" | "speaking";

/**
 * Coordinates interruption of the LLM→TTS pipeline.
 *
 * Usage:
 *   const signal = ic.begin();   // start pipeline, get AbortSignal
 *   // … pass signal to LLM + TTS …
 *   ic.interrupt();               // user spoke — abort everything
 *
 * Events:
 *   "interrupted"  — emitted when a running pipeline is aborted
 */
export class InterruptController extends EventEmitter {
  private ac: AbortController | null = null;
  private _state: PipelineState = "idle";

  get state(): PipelineState {
    return this._state;
  }

  get active(): boolean {
    return this._state !== "idle";
  }

  get signal(): AbortSignal | null {
    return this.ac?.signal ?? null;
  }

  /** Begin a new pipeline run; any previous run is force-aborted first. */
  begin(): AbortSignal {
    this.ac?.abort();
    this.ac = new AbortController();
    this._state = "generating";
    return this.ac.signal;
  }

  /** Transition to "speaking" (TTS is now producing audio). */
  markSpeaking(): void {
    if (this._state === "generating") this._state = "speaking";
  }

  /** Pipeline finished normally. */
  finish(): void {
    this._state = "idle";
    this.ac = null;
  }

  /**
   * Abort the current pipeline (LLM + TTS).
   * Returns `true` if something was actually interrupted.
   */
  interrupt(): boolean {
    if (!this.active) return false;
    this.ac?.abort();
    this.ac = null;
    this._state = "idle";
    this.emit("interrupted");
    return true;
  }
}
