"use client";

import { useCallback, useRef, useState } from "react";
import { base64ToObjectUrl } from "@/lib/audioBase64";

/**
 * Queue base64 audio from server (TTS); exposes whether playback is active
 * and a clearQueue() to stop immediately (used on interrupt).
 */
export function useAudioBase64Queue() {
  const [playing, setPlaying] = useState(false);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const drainRef = useRef<() => void>(() => {});

  const sync = useCallback(() => {
    setPlaying(playingRef.current || queueRef.current.length > 0);
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
    currentAudioRef.current = audio;

    const done = () => {
      URL.revokeObjectURL(url);
      playingRef.current = false;
      currentAudioRef.current = null;
      sync();
      drainRef.current();
    };

    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
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
    // Stop current audio
    const current = currentAudioRef.current;
    if (current) {
      current.onended = null;
      current.onerror = null;
      current.pause();
      try { current.src = ""; } catch {}
      currentAudioRef.current = null;
    }

    // Revoke all queued object URLs
    for (const url of queueRef.current) {
      URL.revokeObjectURL(url);
    }
    queueRef.current = [];
    playingRef.current = false;
    sync();
  }, [sync]);

  return { enqueueBase64, clearQueue, voiceActive: playing };
}
