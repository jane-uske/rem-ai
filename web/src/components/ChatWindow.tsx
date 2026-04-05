"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import { MessageBubble } from "@/components/MessageBubble";

export type ChatWindowProps = {
  messages: ChatMessage[];
  sttPartialText: string;
  streamingText: string;
  /** STT 结束或发送消息后、首 token 到达前 */
  thinkingHint: boolean;
};

export function ChatWindow({
  messages,
  sttPartialText,
  streamingText,
  thinkingHint,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevStreamingRef = useRef("");
  const [streamStatus, setStreamStatus] = useState("");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sttPartialText, streamingText, thinkingHint]);

  useEffect(() => {
    const next = streamingText;
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = next;
    if (!prev && next) {
      setStreamStatus("Rem 正在回复…");
    } else if (prev && !next) {
      setStreamStatus("");
    }
  }, [streamingText]);

  const responseBusy = thinkingHint || Boolean(streamingText);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-transparent">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {streamStatus}
      </div>
      <div
        role="log"
        aria-label="对话消息"
        aria-live="off"
        aria-busy={responseBusy}
        tabIndex={0}
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 outline-none min-[480px]:px-4 min-[480px]:py-4 sm:px-5 sm:py-5 focus-visible:ring-2 focus-visible:ring-[var(--rem-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      >
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role}>
            {m.text}
          </MessageBubble>
        ))}
        {sttPartialText ? (
          <MessageBubble role="partial">{sttPartialText}</MessageBubble>
        ) : null}
        {streamingText ? (
          <MessageBubble role="rem">{streamingText}</MessageBubble>
        ) : null}
        {thinkingHint ? (
          <div
            role="status"
            className="rem-thinking-bubble flex max-w-[85%] flex-wrap items-center gap-2 self-start rounded-2xl rounded-bl-md border border-white/12 bg-[var(--rem-bubble-rem)] px-4 py-3 text-sm text-[var(--foreground)] backdrop-blur-md dark:border-white/10"
          >
            <span className="text-[var(--rem-dim)]">Rem 在想…</span>
            <span className="flex gap-1.5" aria-hidden>
              <span className="rem-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--rem-accent)]" />
              <span className="rem-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--rem-accent)]" />
              <span className="rem-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--rem-accent)]" />
            </span>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
