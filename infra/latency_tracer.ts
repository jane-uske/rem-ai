import { createLogger } from "./logger";

const logger = createLogger("latency");

export interface LatencyTimestamps {
  vad_speech_start?: number;
  vad_speech_end?: number;
  stt_partial?: number;
  stt_final?: number;
  llm_request_start?: number;
  llm_first_token?: number;
  llm_end?: number;
  tts_start?: number;
  tts_first_audio?: number;
  tts_end?: number;
  playback_start?: number;
}

export interface LatencyMetrics {
  stt_latency?: number;
  llm_first_token?: number;
  tts_latency?: number;
  total_response?: number;
  speech_end_to_stt_final?: number;
  stt_final_to_llm_first?: number;
  llm_first_to_tts_first?: number;
  tts_first_to_playback?: number;
}

/**
 * Latency Tracer for tracking pipeline stage timestamps and computing durations.
 *
 * Tracks these timestamps:
 * - vad_speech_start
 * - vad_speech_end
 * - stt_partial
 * - stt_final
 * - llm_request_start
 * - llm_first_token
 * - llm_end
 * - tts_start
 * - tts_first_audio
 * - tts_end
 * - playback_start
 *
 * Computes these durations:
 * - speech_end → stt_final
 * - stt_final → llm_first_token
 * - llm_first_token → tts_first_audio
 * - tts_first_audio → playback
 */
export class LatencyTracer {
  private timestamps: LatencyTimestamps = {};
  private connId: string;
  private completed = false;

  constructor(connId: string) {
    this.connId = connId;
  }

  /** Mark a timestamp with the current time. */
  mark(key: keyof LatencyTimestamps): void {
    if (this.completed) return;
    this.timestamps[key] = Date.now();
  }

  /** Set a timestamp with a specific value (for external events). */
  set(key: keyof LatencyTimestamps, value: number): void {
    if (this.completed) return;
    this.timestamps[key] = value;
  }

  /** Get a specific timestamp. */
  get(key: keyof LatencyTimestamps): number | undefined {
    return this.timestamps[key];
  }

  /** Get all timestamps. */
  getAllTimestamps(): LatencyTimestamps {
    return { ...this.timestamps };
  }

  /**
   * Compute duration between two timestamps in milliseconds.
   * Returns undefined if either timestamp is missing.
   */
  private duration(
    startKey: keyof LatencyTimestamps,
    endKey: keyof LatencyTimestamps,
  ): number | undefined {
    const start = this.timestamps[startKey];
    const end = this.timestamps[endKey];
    if (start === undefined || end === undefined) return undefined;
    return end - start;
  }

  /** Compute all latency metrics from the current timestamps. */
  computeMetrics(): LatencyMetrics {
    return {
      // Legacy metrics for backward compatibility
      stt_latency: this.duration("vad_speech_end", "stt_final"),
      llm_first_token: this.duration("stt_final", "llm_first_token"),
      tts_latency: this.duration("llm_first_token", "tts_first_audio"),
      total_response: this.duration("vad_speech_end", "tts_first_audio"),

      // Detailed metrics
      speech_end_to_stt_final: this.duration("vad_speech_end", "stt_final"),
      stt_final_to_llm_first: this.duration("stt_final", "llm_first_token"),
      llm_first_to_tts_first: this.duration("llm_first_token", "tts_first_audio"),
      tts_first_to_playback: this.duration("tts_first_audio", "playback_start"),
    };
  }

  /**
   * Log the latency metrics as structured JSON.
   * Call this after all stages are complete.
   */
  log(): void {
    if (this.completed) return;
    this.completed = true;

    const metrics = this.computeMetrics();
    const hasAnyMetric = Object.values(metrics).some((v) => v !== undefined);

    if (!hasAnyMetric) {
      logger.debug("[Latency] No metrics available", { connId: this.connId });
      return;
    }

    logger.info("[Latency]", {
      connId: this.connId,
      metrics,
      timestamps: this.timestamps,
    });
  }

  /** Reset the tracer for reuse. */
  reset(): void {
    this.timestamps = {};
    this.completed = false;
  }
}

/**
 * Global store for active latency tracers by connection ID.
 */
const activeTracers = new Map<string, LatencyTracer>();

/** Get or create a latency tracer for a connection. */
export function getLatencyTracer(connId: string): LatencyTracer {
  let tracer = activeTracers.get(connId);
  if (!tracer) {
    tracer = new LatencyTracer(connId);
    activeTracers.set(connId, tracer);
  }
  return tracer;
}

/** Remove a latency tracer when a connection closes. */
export function removeLatencyTracer(connId: string): void {
  activeTracers.delete(connId);
}

/** Mark a timestamp on the tracer for a connection. */
export function markLatency(connId: string, key: keyof LatencyTimestamps): void {
  getLatencyTracer(connId).mark(key);
}

/** Log latency metrics for a connection. */
export function logLatency(connId: string): void {
  getLatencyTracer(connId).log();
}
