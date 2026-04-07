"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { base64ToObjectUrl } from "@/lib/audioBase64";
import type { LipSignal } from "@/types/avatar";

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
  onPlaybackStart?: (generationId: number | null) => void;
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
  const fallbackSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const stopFallbackRef = useRef<(() => void) | null>(null);
  /** Updated ~60fps while TTS plays; read by RemVrmViewer for mouth `aa` blend shape */
  const lipEnvelopeRef = useRef(0);
  const lipSignalRef = useRef<LipSignal>({
    envelope: 0,
    active: false,
    viseme: null,
  });
  const onPlaybackStartRef = useRef(options?.onPlaybackStart);

  useEffect(() => {
    onPlaybackStartRef.current = options?.onPlaybackStart;
  }, [options?.onPlaybackStart]);

  const sync = useCallback(() => {
    setPlaying(playingRef.current);
  }, []);

  const updateLipSignal = useCallback((patch: Partial<LipSignal>) => {
    Object.assign(lipSignalRef.current, patch);
    lipEnvelopeRef.current = lipSignalRef.current.envelope;
  }, []);

  const stopEnvelopeLoop = useCallback(() => {
    if (envelopeRafRef.current) {
      cancelAnimationFrame(envelopeRafRef.current);
      envelopeRafRef.current = 0;
    }
    updateLipSignal({
      envelope: 0,
      active: false,
      viseme: null,
    });
  }, [updateLipSignal]);

  const runEnvelopeLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!analyserRef.current || !playingRef.current) {
        updateLipSignal({
          envelope: 0,
          active: false,
          viseme: null,
        });
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
      updateLipSignal({
        envelope: level,
        active: true,
      });
      envelopeRafRef.current = requestAnimationFrame(tick);
    };
    envelopeRafRef.current = requestAnimationFrame(tick);
  }, [updateLipSignal]);

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
    async (
      buffer: AudioBuffer,
      generationAtCall: number,
      serverGenerationId: number | null,
    ) => {
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
        updateLipSignal({
          active: true,
        });
        stopEnvelopeLoop();
        runEnvelopeLoop();
        sync();
      }
      if (!playbackNotifiedRef.current) {
        playbackNotifiedRef.current = true;
        onPlaybackStartRef.current?.(serverGenerationId);
      }
      scheduleIdleCheck();
    },
    [
      ensureAudioGraph,
      runEnvelopeLoop,
      scheduleIdleCheck,
      stopEnvelopeLoop,
      sync,
      updateLipSignal,
    ],
  );

  const enqueuePcmChunk = useCallback(
    (pcmBase64: string, sampleRate = 24000, serverGenerationId: number | null = null) => {
      const generationAtCall = generationRef.current;
      const floats = pcm16Base64ToFloat32(pcmBase64);
      if (!floats) return;
      const ctxRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 24000;

      const frame = audioContextRef.current?.createBuffer(1, floats.length, ctxRate);
      if (frame) {
        frame.getChannelData(0).set(floats);
        void scheduleAudioBuffer(frame, generationAtCall, serverGenerationId);
      } else {
        // Fallback path if ctx not initialized yet.
        void (async () => {
          const ctx = await ensureAudioGraph();
          if (!ctx || generationRef.current !== generationAtCall) return;
          const buf = ctx.createBuffer(1, floats.length, ctxRate);
          buf.getChannelData(0).set(floats);
          await scheduleAudioBuffer(buf, generationAtCall, serverGenerationId);
        })();
      }
    },
    [ensureAudioGraph, scheduleAudioBuffer],
  );

  const playBase64Fallback = useCallback(
    (base64: string, generationAtCall: number, serverGenerationId: number | null) => {
      if (typeof window === "undefined") return Promise.resolve();
      return (async () => {
        const url = base64ToObjectUrl(base64);
        if (!url) return;
        if (generationRef.current !== generationAtCall) {
          URL.revokeObjectURL(url);
          return;
        }

        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          audio.preload = "auto";
          audio.muted = false;
          audio.volume = 1;
          audio.setAttribute("playsinline", "");
          fallbackAudioRef.current = audio;
          let finishTimer: ReturnType<typeof setTimeout> | null = null;

          const clearFinishTimer = () => {
            if (finishTimer) {
              clearTimeout(finishTimer);
              finishTimer = null;
            }
          };

          const armFinishTimer = () => {
            clearFinishTimer();
            const duration = Number(audio.duration);
            if (!Number.isFinite(duration) || duration <= 0) return;
            finishTimer = setTimeout(() => {
              finish();
            }, duration * 1000 + 320);
          };

          const cleanup = () => {
            if (fallbackAudioRef.current === audio) fallbackAudioRef.current = null;
            if (stopFallbackRef.current === stop) stopFallbackRef.current = null;
            clearFinishTimer();
            audio.onended = null;
            audio.onerror = null;
            audio.onplaying = null;
            audio.onloadedmetadata = null;
            audio.ondurationchange = null;
            try {
              fallbackSourceRef.current?.disconnect();
            } catch {
              /* ignore */
            }
            fallbackSourceRef.current = null;
            URL.revokeObjectURL(url);
          };

          const finish = () => {
            cleanup();
            if (generationRef.current === generationAtCall) {
              playingRef.current = false;
              playbackNotifiedRef.current = false;
              stopEnvelopeLoop();
              sync();
            }
            resolve();
          };

          const stop = () => {
            cleanup();
            resolve();
          };

          stopFallbackRef.current = stop;

          audio.onplaying = () => {
            playingRef.current = true;
            updateLipSignal({ active: true });
            armFinishTimer();
            sync();
            if (!playbackNotifiedRef.current) {
              playbackNotifiedRef.current = true;
              onPlaybackStartRef.current?.(serverGenerationId);
            }
          };
          audio.onloadedmetadata = armFinishTimer;
          audio.ondurationchange = armFinishTimer;
          audio.onended = finish;
          audio.onerror = finish;

          void audio.play().catch(() => {
            finish();
          });
        });
      })();
    },
    [stopEnvelopeLoop, sync, updateLipSignal],
  );

  const enqueueBase64 = useCallback(
    (base64: string, serverGenerationId: number | null = null) => {
      const generationAtCall = generationRef.current;
      decodeChainRef.current = decodeChainRef.current
        .catch(() => {})
        .then(async () => {
          if (generationRef.current !== generationAtCall) return;
          await playBase64Fallback(base64, generationAtCall, serverGenerationId);
        });
    },
    [playBase64Fallback],
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
      stopFallbackRef.current?.();
      fallback.onended = null;
      fallback.onerror = null;
      fallback.onplaying = null;
      fallback.pause();
      try {
        fallback.src = "";
      } catch {
        /* ignore */
      }
      fallbackAudioRef.current = null;
      stopFallbackRef.current = null;
    }
    try {
      fallbackSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    fallbackSourceRef.current = null;
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
    lipSignalRef,
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
