"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getRemWsUrl } from "@/lib/wsUrl";
import type { ChatMessage } from "@/types/chat";
import type { AvatarActionCommand } from "@/types/avatar";
import { useAudioBase64Queue } from "@/hooks/useAudioBase64Queue";
import { startPcmCapture, type PcmCapture } from "@/lib/pcmCapture";

function uid() {
  return crypto.randomUUID();
}

const AUDIO_FRAME_HEADER_BYTES = 16;

function encodePcmAudioFrame(pcm16: ArrayBuffer, sampleRate: number): ArrayBuffer {
  const payload = new Uint8Array(pcm16);
  const frame = new ArrayBuffer(AUDIO_FRAME_HEADER_BYTES + payload.byteLength);
  const out = new Uint8Array(frame);
  const view = new DataView(frame);

  // Magic: "RAUD" (Rem audio), version 1, codec 1=pcm16le mono
  out[0] = 0x52;
  out[1] = 0x41;
  out[2] = 0x55;
  out[3] = 0x44;
  out[4] = 1;
  out[5] = 1;
  out[6] = 0;
  out[7] = 0;
  view.setUint32(8, sampleRate, true);
  view.setUint32(12, payload.byteLength, true);
  out.set(payload, AUDIO_FRAME_HEADER_BYTES);
  return frame;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** WebSocket 断线后自动重连的延迟（与 UI 倒计时同源） */
export const REM_WS_RECONNECT_DELAY_MS = 3000;

/** 长时间停留在 CONNECTING 则判定失败（避免 UI 永远「正在连接」） */
const WS_CONNECT_TIMEOUT_MS = 12_000;

export type RemConnectionPhase = "connecting" | "open" | "closed";

const MESSAGE_STORAGE_KEY = "rem-chat-messages-v1";
const MESSAGE_STORAGE_MAX = 50;

function loadPersistedMessages(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MESSAGE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is ChatMessage =>
          m != null &&
          typeof m === "object" &&
          typeof (m as ChatMessage).id === "string" &&
          typeof (m as ChatMessage).text === "string" &&
          typeof (m as ChatMessage).role === "string",
      )
      .slice(-MESSAGE_STORAGE_MAX);
  } catch {
    return [];
  }
}

export function useRemChat() {
  const [emotion, setEmotion] = useState("neutral");
  const [connected, setConnected] = useState(false);
  const [connectionPhase, setConnectionPhase] =
    useState<RemConnectionPhase>("connecting");
  const [reconnectDeadline, setReconnectDeadline] = useState<number | null>(null);
  /** 仅用于在重连倒计时期间驱动按秒刷新（deadline 派生秒数） */
  const [, bumpReconnectTick] = useState(0);
  const [connLabel, setConnLabel] = useState("连接中…");
  const [messages, setMessages] = useState<ChatMessage[]>(loadPersistedMessages);
  const [streamingText, setStreamingText] = useState("");
  const [sttPartialText, setSttPartialText] = useState("");
  const [typing, setTyping] = useState(false);
  /** 首 token 前：展示「Rem 在想…」（S9） */
  const thinkingHint = typing && streamingText.length === 0;
  const [waiting, setWaiting] = useState(false);
  const [avatarAction, setAvatarAction] = useState<{
    action: AvatarActionCommand;
    nonce: number;
  } | null>(null);
  const [inputPlaceholder, setInputPlaceholder] = useState("说点什么…");
  const [recording, setRecording] = useState(false);
  const [duplex, setDuplex] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const waitingRef = useRef(false);
  const duplexRef = useRef(false);
  const pcmRef = useRef<PcmCapture | null>(null);
  const recordingRef = useRef(false);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingBufRef = useRef("");
  const mountedRef = useRef(true);
  const activeGenerationRef = useRef<number | null>(null);
  const blockedGenerationsRef = useRef<Set<number>>(new Set());
  /** 连接超时主动 close 时，onclose 不再刷「已断开」系统提示（避免与超时错误重复） */
  const suppressDisconnectSysMsgRef = useRef(false);

  const clearGenerationState = useCallback(() => {
    activeGenerationRef.current = null;
    blockedGenerationsRef.current.clear();
  }, []);

  const blockGeneration = useCallback((id: number) => {
    const blocked = blockedGenerationsRef.current;
    blocked.add(id);
    if (blocked.size > 128) {
      const oldest = blocked.values().next();
      if (!oldest.done) blocked.delete(oldest.value);
    }
    if (activeGenerationRef.current === id) {
      activeGenerationRef.current = null;
    }
  }, []);

  const parseGenerationId = useCallback((raw: unknown): number | null => {
    if (raw == null) return null;
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
    if (typeof raw === "string") {
      const n = Number(raw);
      if (Number.isFinite(n)) return Math.floor(n);
    }
    return null;
  }, []);

  const { enqueueBase64, enqueuePcmChunk, clearQueue, voiceActive, lipEnvelopeRef } =
    useAudioBase64Queue({
      onPlaybackStart: () => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "playback_start" }));
      },
    });

  useEffect(() => {
    if (reconnectDeadline == null) return;
    const id = setInterval(() => {
      bumpReconnectTick((n) => n + 1);
    }, 250);
    return () => clearInterval(id);
  }, [reconnectDeadline]);

  const reconnectInSec =
    reconnectDeadline == null
      ? null
      : Math.max(0, Math.ceil((reconnectDeadline - Date.now()) / 1000));

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

  const allowServerGeneration = useCallback(
    (type: string, rawGenerationId: unknown): boolean => {
      const id = parseGenerationId(rawGenerationId);
      if (id == null) return true; // Backward-compatible path for older servers.

      if (blockedGenerationsRef.current.has(id)) {
        return false;
      }

      const active = activeGenerationRef.current;
      if (active == null) {
        activeGenerationRef.current = id;
        return true;
      }
      if (active === id) return true;

      // Allow rollover only on token start; otherwise old/new chunks might interleave.
      if (type === "chat_chunk") {
        clearQueue();
        resetStreaming();
        activeGenerationRef.current = id;
        return true;
      }
      return false;
    },
    [clearQueue, parseGenerationId, resetStreaming],
  );

  /* ── Full-duplex voice（须在 WebSocket 回调之前定义）── */

  const startDuplex = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Local pre-barge-in: stop any queued/playing TTS immediately.
    clearQueue();
    setSttPartialText("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      let pcmSampleRate = 16000;
      const capture = await startPcmCapture(stream, (pcm16) => {
        if (ws.readyState === WebSocket.OPEN) {
          const frame = encodePcmAudioFrame(pcm16, pcmSampleRate);
          try {
            ws.send(frame);
          } catch {
            // Compatibility fallback for servers that only parse JSON audio_stream.
            ws.send(
              JSON.stringify({
                type: "audio_stream",
                audio: arrayBufferToBase64(pcm16),
                sampleRate: pcmSampleRate,
              }),
            );
          }
        }
      });
      pcmSampleRate = capture.sampleRate;

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
  }, [clearQueue]);

  const stopVoiceSession = useCallback(() => {
    const ws = wsRef.current;
    if (pcmRef.current) {
      pcmRef.current.stop();
      pcmRef.current = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "duplex_stop" }));
    }
    setSttPartialText("");
    clearGenerationState();
    duplexRef.current = false;
    setDuplex(false);
    setRecording(false);
    recordingRef.current = false;
    setUserSpeaking(false);
    setInputPlaceholder("说点什么…");
  }, [clearGenerationState]);

  const toggleMic = useCallback(() => {
    if (recordingRef.current) {
      stopVoiceSession();
    } else {
      activeGenerationRef.current = null;
      void startDuplex();
    }
  }, [startDuplex, stopVoiceSession]);

  /* ── WebSocket connection ── */

  const connectRef = useRef<() => void>(() => {});

  connectRef.current = () => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    setReconnectDeadline(null);
    setConnectionPhase("connecting");
    setConnLabel("连接中…");
    const url = getRemWsUrl();
    if (!url) {
      setConnectionPhase("closed");
      setConnLabel("无法解析 WS 地址");
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "error",
          text: "WebSocket 地址为空（仅应在浏览器环境连接）",
        },
      ]);
      return;
    }

    const ws = new WebSocket(url);
    clearGenerationState();
    wsRef.current = ws;

    const connectTimer = window.setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        suppressDisconnectSysMsgRef.current = true;
        setConnLabel("连接超时");
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "error",
            text:
              "连接服务器超时。请确认已在仓库根目录运行「npm run dev」（默认端口 3000），或设置 NEXT_PUBLIC_WS_URL=ws://你的后端:端口/ws",
          },
        ]);
        ws.close();
      }
    }, WS_CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      window.clearTimeout(connectTimer);
      setConnected(true);
      setConnectionPhase("open");
      setReconnectDeadline(null);
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
          if (!allowServerGeneration("chat_chunk", data.generationId)) break;
          setSttPartialText("");
          setTyping(false);
          appendStreaming(String(data.content ?? ""));
          break;

        case "chat_end": {
          if (!allowServerGeneration("chat_end", data.generationId)) break;
          const text = streamingBufRef.current;
          resetStreaming();
          if (!duplexRef.current) {
            waitingRef.current = false;
            setWaiting(false);
          }
          setSttPartialText("");
          setInputPlaceholder("说点什么…");
          if (text) {
            setMessages((m) => [...m, { id: uid(), role: "rem", text }]);
          }
          const endGenerationId = parseGenerationId(data.generationId);
          if (endGenerationId != null && activeGenerationRef.current === endGenerationId) {
            activeGenerationRef.current = null;
          }
          if (data.emotion != null) setEmotion(String(data.emotion));
          break;
        }

        case "voice":
          if (!allowServerGeneration("voice", data.generationId)) break;
          if (typeof data.audio === "string") {
            enqueueBase64(data.audio);
          }
          break;

        case "voice_chunk":
        case "voice_pcm_chunk": {
          if (!allowServerGeneration("voice_pcm_chunk", data.generationId)) break;
          if (typeof data.audio === "string") {
            const rate = Number(data.sampleRate);
            enqueuePcmChunk(data.audio, Number.isFinite(rate) && rate > 0 ? rate : 24000);
          }
          break;
        }

        case "avatar_frame": {
          const frame = data.frame as
            | {
                action?: AvatarActionCommand;
                emotion?: string;
              }
            | undefined;
          if (frame?.emotion) setEmotion(String(frame.emotion));
          if (frame?.action) {
            setAvatarAction({
              action: frame.action,
              nonce: Date.now() + Math.floor(Math.random() * 1000),
            });
          }
          break;
        }

        /* ── Full-duplex events ── */

        case "interrupt": {
          const interruptedGeneration = parseGenerationId(data.generationId);
          if (interruptedGeneration != null) {
            blockGeneration(interruptedGeneration);
          } else {
            activeGenerationRef.current = null;
          }
          setSttPartialText("");
          clearQueue();
          resetStreaming();
          setTyping(false);
          break;
        }

        case "vad_start":
          setSttPartialText("");
          setUserSpeaking(true);
          setInputPlaceholder("正在听…");
          break;

        case "vad_end":
          setUserSpeaking(false);
          break;

        case "stt_partial":
          setSttPartialText(String(data.content ?? "").trim());
          break;

        case "stt_final": {
          const content = String(data.content ?? "");
          activeGenerationRef.current = null;
          setSttPartialText("");
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
          setSttPartialText("");
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
      window.clearTimeout(connectTimer);
      if (!mountedRef.current) return;

      stopVoiceSession();

      setConnected(false);
      setConnectionPhase("closed");
      setReconnectDeadline(Date.now() + REM_WS_RECONNECT_DELAY_MS);
      setConnLabel("已断开");
      waitingRef.current = false;
      setWaiting(false);
      clearGenerationState();
      setSttPartialText("");
      resetStreaming();
      setTyping(false);
      const quiet = suppressDisconnectSysMsgRef.current;
      suppressDisconnectSysMsgRef.current = false;
      if (!quiet) {
        setMessages((m) => [
          ...m,
          { id: uid(), role: "sys", text: "连接已断开，3 秒后重连…" },
        ]);
      }
      reconnectRef.current = setTimeout(() => {
        if (mountedRef.current) connectRef.current?.();
      }, REM_WS_RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      window.clearTimeout(connectTimer);
    };
  };

  useEffect(() => {
    mountedRef.current = true;
    connectRef.current?.();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [allowServerGeneration, appendStreaming, blockGeneration, clearGenerationState, clearQueue, enqueueBase64, enqueuePcmChunk, parseGenerationId, resetStreaming, stopVoiceSession]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const persist = messages
      .filter((m) => m.role === "user" || m.role === "rem")
      .slice(-MESSAGE_STORAGE_MAX);
    try {
      localStorage.setItem(MESSAGE_STORAGE_KEY, JSON.stringify(persist));
    } catch {
      /* quota or private mode */
    }
  }, [messages]);

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
      // Sending a new user text should immediately stop current/queued playback.
      clearQueue();
      activeGenerationRef.current = null;
      setSttPartialText("");
      setMessages((m) => [...m, { id: uid(), role: "user", text: trimmed }]);
      ws.send(JSON.stringify({ type: "chat", content: trimmed }));
      waitingRef.current = true;
      setWaiting(true);
      setTyping(true);
      resetStreaming();
    },
    [clearQueue, resetStreaming],
  );

  return {
    emotion,
    connected,
    connectionPhase,
    reconnectInSec,
    connLabel,
    messages,
    streamingText,
    sttPartialText,
    typing,
    thinkingHint,
    waiting,
    avatarAction,
    inputPlaceholder,
    recording,
    duplex,
    userSpeaking,
    voiceActive,
    /** TTS 音量包络 0–1，供 3D 口型同步 */
    lipEnvelopeRef,
    hasMic,
    sendText,
    toggleMic,
    /** 显式结束语音会话（与再点麦克风等效） */
    stopVoice: stopVoiceSession,
    setInputPlaceholder,
  };
}
