"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getRemWsUrl } from "@/lib/wsUrl";
import type { ChatMessage } from "@/types/chat";
import { useAudioBase64Queue } from "@/hooks/useAudioBase64Queue";
import { startPcmCapture, type PcmCapture } from "@/lib/pcmCapture";

function uid() {
  return crypto.randomUUID();
}

export function useRemChat() {
  const { enqueueBase64, clearQueue, voiceActive } = useAudioBase64Queue();

  const [emotion, setEmotion] = useState("neutral");
  const [connected, setConnected] = useState(false);
  const [connLabel, setConnLabel] = useState("连接中…");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [typing, setTyping] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [inputPlaceholder, setInputPlaceholder] = useState("说点什么…");
  const [recording, setRecording] = useState(false);
  const [duplex, setDuplex] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const waitingRef = useRef(false);
  const duplexRef = useRef(false);
  const pcmRef = useRef<PcmCapture | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingRef = useRef(false);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingBufRef = useRef("");
  const mountedRef = useRef(true);

  const hasMic =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  /* ── Streaming text helpers ── */

  const appendStreaming = useCallback((chunk: string) => {
    streamingBufRef.current += chunk;
    setStreamingText(streamingBufRef.current);
  }, []);

  const resetStreaming = useCallback(() => {
    streamingBufRef.current = "";
    setStreamingText("");
  }, []);

  /* ── WebSocket connection ── */

  const connectRef = useRef<() => void>(() => {});

  connectRef.current = () => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    setConnLabel("连接中…");
    const url = getRemWsUrl();
    if (!url) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnLabel("在线");
      setMessages((m) => [
        ...m,
        { id: uid(), role: "sys", text: "已连接，和 Rem 聊聊吧" },
      ]);
    };

    ws.onmessage = (ev) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(ev.data as string) as Record<string, unknown>;
      } catch {
        return;
      }

      const t = data.type as string;

      switch (t) {
        case "emotion":
          if (data.emotion != null) setEmotion(String(data.emotion));
          break;

        case "chat_chunk":
          setTyping(false);
          appendStreaming(String(data.content ?? ""));
          break;

        case "chat_end": {
          const text = streamingBufRef.current;
          resetStreaming();
          if (!duplexRef.current) {
            waitingRef.current = false;
            setWaiting(false);
          }
          setInputPlaceholder("说点什么…");
          if (text) {
            setMessages((m) => [...m, { id: uid(), role: "rem", text }]);
          }
          if (data.emotion != null) setEmotion(String(data.emotion));
          break;
        }

        case "voice":
          if (typeof data.audio === "string") {
            enqueueBase64(data.audio);
          }
          break;

        /* ── Full-duplex events ── */

        case "interrupt":
          clearQueue();
          resetStreaming();
          break;

        case "vad_start":
          setUserSpeaking(true);
          setInputPlaceholder("正在听…");
          break;

        case "vad_end":
          setUserSpeaking(false);
          break;

        case "stt_partial":
          break;

        case "stt_final": {
          setTyping(false);
          const content = String(data.content ?? "");
          setMessages((m) => [...m, { id: uid(), role: "user", text: content }]);
          setInputPlaceholder("说点什么…");
          if (!duplexRef.current) {
            waitingRef.current = true;
            setWaiting(true);
          }
          setTyping(true);
          break;
        }

        case "error": {
          setTyping(false);
          resetStreaming();
          waitingRef.current = false;
          setWaiting(false);
          setInputPlaceholder("说点什么…");
          setMessages((m) => [
            ...m,
            { id: uid(), role: "error", text: String(data.content ?? "错误") },
          ]);
          break;
        }

        default:
          break;
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;

      // Tear down duplex / legacy recording
      stopDuplexInternal();
      stopLegacyRecording();

      setConnected(false);
      setConnLabel("已断开");
      waitingRef.current = false;
      setWaiting(false);
      resetStreaming();
      setTyping(false);
      setMessages((m) => [
        ...m,
        { id: uid(), role: "sys", text: "连接已断开，3 秒后重连…" },
      ]);
      reconnectRef.current = setTimeout(() => {
        if (mountedRef.current) connectRef.current?.();
      }, 3000);
    };

    ws.onerror = () => {};
  };

  useEffect(() => {
    mountedRef.current = true;
    connectRef.current?.();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);

  /* ── Text chat ── */

  const sendText = useCallback(
    (text: string) => {
      const ws = wsRef.current;
      const trimmed = text.trim();
      if (
        !trimmed ||
        waitingRef.current ||
        !ws ||
        ws.readyState !== WebSocket.OPEN
      )
        return;
      setMessages((m) => [...m, { id: uid(), role: "user", text: trimmed }]);
      ws.send(JSON.stringify({ type: "chat", content: trimmed }));
      waitingRef.current = true;
      setWaiting(true);
      setTyping(true);
      resetStreaming();
    },
    [resetStreaming],
  );

  /* ── Full-duplex voice ── */

  const startDuplex = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const capture = startPcmCapture(stream, (base64) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "audio_stream", audio: base64 }));
        }
      });

      pcmRef.current = capture;
      ws.send(JSON.stringify({ type: "duplex_start", sampleRate: capture.sampleRate }));

      duplexRef.current = true;
      setDuplex(true);
      setRecording(true);
      recordingRef.current = true;
      setInputPlaceholder("全双工语音 — 随时说话…");
    } catch {
      setMessages((m) => [
        ...m,
        { id: uid(), role: "error", text: "无法访问麦克风" },
      ]);
    }
  }, []);

  function stopDuplexInternal() {
    const ws = wsRef.current;
    if (pcmRef.current) {
      pcmRef.current.stop();
      pcmRef.current = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "duplex_stop" }));
    }
    duplexRef.current = false;
    setDuplex(false);
    setRecording(false);
    recordingRef.current = false;
    setUserSpeaking(false);
    setInputPlaceholder("说点什么…");
  }

  const stopDuplex = useCallback(() => {
    stopDuplexInternal();
  }, []);

  /* ── Legacy half-duplex voice (fallback) ── */

  function stopLegacyRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      try { mr.stop(); } catch {}
    }
    recordingRef.current = false;
    setRecording(false);
  }

  const startLegacyRecording = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        const reader = new FileReader();
        reader.onload = () => {
          const r = reader.result as string;
          const b64 = r.split(",")[1];
          ws.send(JSON.stringify({ type: "audio_chunk", audio: b64 }));
        };
        reader.readAsDataURL(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        ws.send(JSON.stringify({ type: "audio_end" }));
        setTyping(true);
      };

      mediaRecorder.start(500);
      recordingRef.current = true;
      setRecording(true);
      setInputPlaceholder("录音中…");
    } catch {
      setMessages((m) => [
        ...m,
        { id: uid(), role: "error", text: "无法访问麦克风" },
      ]);
    }
  }, []);

  const stopLegacyRecordingCb = useCallback(() => {
    stopLegacyRecording();
    setInputPlaceholder("识别中…");
    waitingRef.current = true;
    setWaiting(true);
  }, []);

  /* ── Unified mic toggle ──
   *  Long-press or single tap enters full-duplex mode.
   *  Tap again to exit.
   */

  const toggleMic = useCallback(() => {
    if (recordingRef.current) {
      if (pcmRef.current) {
        stopDuplexInternal();
      } else {
        stopLegacyRecordingCb();
      }
    } else {
      void startDuplex();
    }
  }, [startDuplex, stopLegacyRecordingCb]);

  return {
    emotion,
    connected,
    connLabel,
    messages,
    streamingText,
    typing,
    waiting,
    inputPlaceholder,
    recording,
    duplex,
    userSpeaking,
    voiceActive,
    hasMic,
    sendText,
    toggleMic,
    setInputPlaceholder,
  };
}
