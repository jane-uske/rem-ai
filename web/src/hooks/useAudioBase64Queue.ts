"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { base64ToObjectUrl } from "@/lib/audioBase64";

/**
 * Queue server TTS audio. Supports:
 * - legacy complete clips (`voice`: base64 encoded wav/mp3)
 * - streamed PCM chunks (`voice_pcm_chunk`: base64 encoded pcm16le mono)
 *
 * Routes playback through Web Audio + AnalyserNode so `lipEnvelopeRef` holds
 * 0–1 RMS envelope for lip-sync with the 3D avatar.
 */
export interface AudioQueueOptions {
  /** Called when a server TTS segment actually starts playing on client. */
  onPlaybackStart?: () => void;
}

export function useAudioBase64Queue(options?: AudioQueueOptions) {
  const [playing, setPlaying] = useState(false);
  const decodeChainRef = useRef<Promise<void>>(Promise.resolve());
  const playingRef = useRef(false);
  const generationRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackNotifiedRef = useRef(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserReadyRef = useRef(false);
  const envelopeRafRef = useRef(0);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  /** Updated ~60fps while TTS plays; read by RemVrmViewer for mouth `aa` blend shape */
  const lipEnvelopeRef = useRef(0);
  const onPlaybackStartRef = useRef(options?.onPlaybackStart);

  useEffect(() => {
    onPlaybackStartRef.current = options?.onPlaybackStart;
  }, [options?.onPlaybackStart]);

  const sync = useCallback(() => {
    setPlaying(playingRef.current);
  }, []);

  const stopEnvelopeLoop = useCallback(() => {
    if (envelopeRafRef.current) {
      cancelAnimationFrame(envelopeRafRef.current);
      envelopeRafRef.current = 0;
    }
    lipEnvelopeRef.current = 0;
    analyserRef.current = null;
  }, []);

  const runEnvelopeLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!analyserRef.current || !playingRef.current) {
        lipEnvelopeRef.current = 0;
        return;
      }
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      // Boost speech RMS into a visible mouth range; clamp
      const level = Math.min(1, Math.pow(rms * 7.2, 0.82));
      lipEnvelopeRef.current = level;
      envelopeRafRef.current = requestAnimationFrame(tick);
    };
    envelopeRafRef.current = requestAnimationFrame(tick);
  }, []);

  const ensureAudioGraph = useCallback(async (): Promise<AudioContext | null> => {
    if (typeof window === "undefined") return null;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;

    const ctx = audioContextRef.current ?? new Ctx();
    audioContextRef.current = ctx;
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }

    if (!analyserReadyRef.current) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.45;
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      analyserReadyRef.current = true;
    }
    return ctx;
  }, []);

  const unlockPlayback = useCallback(async (): Promise<void> => {
    const ctx = await ensureAudioGraph();
    if (!ctx) return;
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }, [ensureAudioGraph]);

  const scheduleIdleCheck = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const remainMs = Math.max(20, (nextStartTimeRef.current - ctx.currentTime) * 1000 + 20);
    idleTimerRef.current = setTimeout(() => {
      if (activeSourcesRef.current.size > 0) return;
      const now = audioContextRef.current?.currentTime ?? 0;
      if (now + 0.01 < nextStartTimeRef.current) return;
      playingRef.current = false;
      playbackNotifiedRef.current = false;
      stopEnvelopeLoop();
      sync();
    }, remainMs);
  }, [stopEnvelopeLoop, sync]);

  const scheduleAudioBuffer = useCallback(
    async (buffer: AudioBuffer, generationAtCall: number) => {
      const ctx = await ensureAudioGraph();
      if (!ctx) return;
      if (generationRef.current !== generationAtCall) return;
      const analyser = analyserRef.current;
      if (!analyser) return;

      const now = ctx.currentTime;
      const startAt = Math.max(now + 0.01, nextStartTimeRef.current || now + 0.01);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      source.onended = () => {
        activeSourcesRef.current.delete(source);
      };
      activeSourcesRef.current.add(source);
      source.start(startAt);
      nextStartTimeRef.current = startAt + buffer.duration;

      if (!playingRef.current) {
        playingRef.current = true;
        stopEnvelopeLoop();
        runEnvelopeLoop();
        sync();
      }
      if (!playbackNotifiedRef.current) {
        playbackNotifiedRef.current = true;
        onPlaybackStartRef.current?.();
      }
      scheduleIdleCheck();
    },
    [ensureAudioGraph, runEnvelopeLoop, scheduleIdleCheck, stopEnvelopeLoop, sync],
  );

  const enqueuePcmChunk = useCallback(
    (pcmBase64: string, sampleRate = 24000) => {
      const generationAtCall = generationRef.current;
      const floats = pcm16Base64ToFloat32(pcmBase64);
      if (!floats) return;
      const ctxRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 24000;

      const frame = audioContextRef.current?.createBuffer(1, floats.length, ctxRate);
      if (frame) {
        frame.getChannelData(0).set(floats);
        void scheduleAudioBuffer(frame, generationAtCall);
      } else {
        // Fallback path if ctx not initialized yet.
        void (async () => {
          const ctx = await ensureAudioGraph();
          if (!ctx || generationRef.current !== generationAtCall) return;
          const buf = ctx.createBuffer(1, floats.length, ctxRate);
          buf.getChannelData(0).set(floats);
          await scheduleAudioBuffer(buf, generationAtCall);
        })();
      }
    },
    [ensureAudioGraph, scheduleAudioBuffer],
  );

  const playBase64Fallback = useCallback(
    (base64: string, generationAtCall: number) => {
      if (typeof window === "undefined") return;
      const url = base64ToObjectUrl(base64);
      if (!url) return;
      if (generationRef.current !== generationAtCall) {
        URL.revokeObjectURL(url);
        return;
      }

      const audio = new Audio(url);
      audio.preload = "auto";
      audio.setAttribute("playsinline", "");
      fallbackAudioRef.current = audio;

      const cleanup = () => {
        if (fallbackAudioRef.current === audio) fallbackAudioRef.current = null;
        URL.revokeObjectURL(url);
        audio.onended = null;
        audio.onerror = null;
      };

      audio.onended = () => {
        cleanup();
        if (generationRef.current !== generationAtCall) return;
        playingRef.current = false;
        playbackNotifiedRef.current = false;
        stopEnvelopeLoop();
        sync();
      };
      audio.onerror = () => {
        cleanup();
        if (generationRef.current !== generationAtCall) return;
        playingRef.current = false;
        playbackNotifiedRef.current = false;
        stopEnvelopeLoop();
        sync();
      };

      playingRef.current = true;
      sync();
      if (!playbackNotifiedRef.current) {
        playbackNotifiedRef.current = true;
        onPlaybackStartRef.current?.();
      }

      void audio.play().catch(() => {
        cleanup();
        if (generationRef.current !== generationAtCall) return;
        playingRef.current = false;
        playbackNotifiedRef.current = false;
        stopEnvelopeLoop();
        sync();
      });
    },
    [stopEnvelopeLoop, sync],
  );

  const enqueueBase64 = useCallback(
    (base64: string) => {
      const generationAtCall = generationRef.current;
      decodeChainRef.current = decodeChainRef.current
        .catch(() => {})
        .then(async () => {
          if (generationRef.current !== generationAtCall) return;
          const bytes = base64ToUint8Array(base64);
          if (!bytes) return;
          const ctx = await ensureAudioGraph();
          if (!ctx || generationRef.current !== generationAtCall) {
            playBase64Fallback(base64, generationAtCall);
            return;
          }
          let decoded: AudioBuffer;
          try {
            decoded = await ctx.decodeAudioData(toArrayBuffer(bytes));
          } catch {
            playBase64Fallback(base64, generationAtCall);
            return;
          }
          if (generationRef.current !== generationAtCall) return;
          await scheduleAudioBuffer(decoded, generationAtCall);
        });
    },
    [ensureAudioGraph, playBase64Fallback, scheduleAudioBuffer],
  );

  /** Stop current playback and discard all queued audio (used on interrupt). */
  const clearQueue = useCallback(() => {
    generationRef.current += 1;

    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    for (const src of activeSourcesRef.current) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* ignore */
      }
    }
    activeSourcesRef.current.clear();
    const fallback = fallbackAudioRef.current;
    if (fallback) {
      fallback.onended = null;
      fallback.onerror = null;
      fallback.pause();
      try {
        fallback.src = "";
      } catch {
        /* ignore */
      }
      fallbackAudioRef.current = null;
    }
    nextStartTimeRef.current = 0;
    playbackNotifiedRef.current = false;

    stopEnvelopeLoop();
    playingRef.current = false;
    sync();
  }, [stopEnvelopeLoop, sync]);

  return {
    enqueueBase64,
    enqueuePcmChunk,
    clearQueue,
    unlockPlayback,
    voiceActive: playing,
    lipEnvelopeRef,
  };
}

function base64ToUint8Array(base64: string): Uint8Array | null {
  try {
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

function pcm16Base64ToFloat32(base64: string): Float32Array | null {
  const bytes = base64ToUint8Array(base64);
  if (!bytes || bytes.byteLength < 2) return null;
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < sampleCount; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}
