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

export interface LatencyTraceContext {
  generationId?: number;
  source?: "voice" | "text" | "silence_nudge";
}

type TraceState = {
  timestamps: LatencyTimestamps;
  completed: boolean;
  context?: LatencyTraceContext;
};

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
  private traces = new Map<string, TraceState>();
  private readonly defaultTraceId = "legacy";
  private connId: string;

  constructor(connId: string) {
    this.connId = connId;
  }

  private ensureTrace(traceId: string): TraceState {
    let trace = this.traces.get(traceId);
    if (!trace) {
      trace = {
        timestamps: {},
        completed: false,
      };
      this.traces.set(traceId, trace);
    }
    return trace;
  }

  startTrace(traceId: string, context?: LatencyTraceContext): void {
    if (!traceId) return;
    const trace = this.ensureTrace(traceId);
    if (trace.completed) {
      trace.timestamps = {};
      trace.completed = false;
    }
    if (context) {
      trace.context = {
        ...(trace.context ?? {}),
        ...context,
      };
    }
  }

  /** Mark a timestamp with the current time. */
  mark(key: keyof LatencyTimestamps, traceId: string = this.defaultTraceId): void {
    const trace = this.ensureTrace(traceId);
    if (trace.completed) return;
    trace.timestamps[key] = Date.now();
  }

  /** Set a timestamp with a specific value (for external events). */
  set(key: keyof LatencyTimestamps, value: number, traceId: string = this.defaultTraceId): void {
    const trace = this.ensureTrace(traceId);
    if (trace.completed) return;
    trace.timestamps[key] = value;
  }

  /** Get a specific timestamp. */
  get(key: keyof LatencyTimestamps, traceId: string = this.defaultTraceId): number | undefined {
    return this.traces.get(traceId)?.timestamps[key];
  }

  /** Get all timestamps. */
  getAllTimestamps(traceId: string = this.defaultTraceId): LatencyTimestamps {
    return { ...(this.traces.get(traceId)?.timestamps ?? {}) };
  }

  /**
   * Compute duration between two timestamps in milliseconds.
   * Returns undefined if either timestamp is missing.
   */
  private duration(
    startKey: keyof LatencyTimestamps,
    endKey: keyof LatencyTimestamps,
    timestamps: LatencyTimestamps,
  ): number | undefined {
    const start = timestamps[startKey];
    const end = timestamps[endKey];
    if (start === undefined || end === undefined) return undefined;
    return end - start;
  }

  /** Compute all latency metrics from the current timestamps. */
  computeMetrics(traceId: string = this.defaultTraceId): LatencyMetrics {
    const timestamps = this.traces.get(traceId)?.timestamps ?? {};
    return {
      // Legacy metrics for backward compatibility
      stt_latency: this.duration("vad_speech_end", "stt_final", timestamps),
      llm_first_token: this.duration("stt_final", "llm_first_token", timestamps),
      tts_latency: this.duration("llm_first_token", "tts_first_audio", timestamps),
      total_response: this.duration("vad_speech_end", "tts_first_audio", timestamps),

      // Detailed metrics
      speech_end_to_stt_final: this.duration("vad_speech_end", "stt_final", timestamps),
      stt_final_to_llm_first: this.duration("stt_final", "llm_first_token", timestamps),
      llm_first_to_tts_first: this.duration("llm_first_token", "tts_first_audio", timestamps),
      tts_first_to_playback: this.duration("tts_first_audio", "playback_start", timestamps),
    };
  }

  /**
   * Log the latency metrics as structured JSON.
   * Call this after all stages are complete.
   */
  log(traceId: string = this.defaultTraceId): void {
    const trace = this.traces.get(traceId);
    if (!trace || trace.completed) return;
    trace.completed = true;

    const metrics = this.computeMetrics(traceId);
    const hasAnyMetric = Object.values(metrics).some((v) => v !== undefined);

    if (!hasAnyMetric) {
      logger.debug("[Latency] No metrics available", { connId: this.connId, traceId });
      return;
    }

    logger.info("[Latency]", {
      connId: this.connId,
      traceId,
      generationId: trace.context?.generationId,
      source: trace.context?.source,
      metrics,
      timestamps: trace.timestamps,
    });
  }

  /** Reset the tracer for reuse. */
  reset(traceId?: string): void {
    if (traceId) {
      this.traces.delete(traceId);
      return;
    }
    this.traces.clear();
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
