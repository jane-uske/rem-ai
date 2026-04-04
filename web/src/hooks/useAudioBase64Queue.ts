"use client";

import { useCallback, useRef, useState } from "react";
import { base64ToObjectUrl } from "@/lib/audioBase64";

/**
 * Queue base64 audio from server (TTS); exposes whether playback is active
 * and clearQueue() to stop immediately (used on interrupt).
 *
 * Routes playback through Web Audio + AnalyserNode so `lipEnvelopeRef` holds
 * 0–1 RMS envelope for lip-sync with the 3D avatar.
 */
export function useAudioBase64Queue() {
  const [playing, setPlaying] = useState(false);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const drainRef = useRef<() => void>(() => {});

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const envelopeRafRef = useRef(0);
  /** Updated ~60fps while TTS plays; read by RemVrmViewer for mouth `aa` blend shape */
  const lipEnvelopeRef = useRef(0);

  const sync = useCallback(() => {
    setPlaying(playingRef.current || queueRef.current.length > 0);
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

  drainRef.current = () => {
    if (playingRef.current || queueRef.current.length === 0) {
      sync();
      return;
    }
    playingRef.current = true;
    sync();
    const url = queueRef.current.shift()!;
    const audio = new Audio(url);
    audio.setAttribute("playsinline", "");
    currentAudioRef.current = audio;

    const done = () => {
      stopEnvelopeLoop();
      URL.revokeObjectURL(url);
      playingRef.current = false;
      currentAudioRef.current = null;
      sync();
      drainRef.current();
    };

    audio.onended = done;
    audio.onerror = done;

    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        void audio.play().catch(done);
        return;
      }
      const ctx = audioContextRef.current ?? new Ctx();
      audioContextRef.current = ctx;
      void ctx.resume();

      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.45;
      analyserRef.current = analyser;
      source.connect(analyser);
      analyser.connect(ctx.destination);

      stopEnvelopeLoop();
      runEnvelopeLoop();
    } catch {
      analyserRef.current = null;
    }

    void audio.play().catch(done);
  };

  const enqueueBase64 = useCallback(
    (base64: string) => {
      const url = base64ToObjectUrl(base64);
      if (!url) return;
      queueRef.current.push(url);
      sync();
      drainRef.current();
    },
    [sync],
  );

  /** Stop current playback and discard all queued audio (used on interrupt). */
  const clearQueue = useCallback(() => {
    stopEnvelopeLoop();

    const current = currentAudioRef.current;
    if (current) {
      current.onended = null;
      current.onerror = null;
      current.pause();
      try {
        current.src = "";
      } catch {
        /* ignore */
      }
      currentAudioRef.current = null;
    }

    for (const url of queueRef.current) {
      URL.revokeObjectURL(url);
    }
    queueRef.current = [];
    playingRef.current = false;
    sync();
  }, [stopEnvelopeLoop, sync]);

  return { enqueueBase64, clearQueue, voiceActive: playing, lipEnvelopeRef };
}
