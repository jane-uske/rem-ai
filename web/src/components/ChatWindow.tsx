"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/types/chat";
import { MessageBubble } from "@/components/MessageBubble";

export type ChatWindowProps = {
  messages: ChatMessage[];
  streamingText: string;
  /** STT 结束或发送消息后、首 token 到达前 */
  thinkingHint: boolean;
};

export function ChatWindow({
  messages,
  streamingText,
  thinkingHint,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamingText, thinkingHint]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[var(--background)]">
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-5">
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role}>
            {m.text}
          </MessageBubble>
        ))}
        {streamingText ? (
          <MessageBubble role="rem">{streamingText}</MessageBubble>
        ) : null}
        {thinkingHint ? (
          <div
            className="rem-thinking-bubble flex max-w-[85%] flex-wrap items-center gap-2 self-start rounded-2xl rounded-bl-md bg-[var(--rem-surface)] px-[18px] py-3 text-sm text-[var(--foreground)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.35)]"
            aria-live="polite"
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
