"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/types/chat";
import { MessageBubble } from "@/components/MessageBubble";

export type ChatWindowProps = {
  messages: ChatMessage[];
  streamingText: string;
  typing: boolean;
};

export function ChatWindow({ messages, streamingText, typing }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamingText, typing]);

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
        <div
          className={
            typing
              ? "flex self-start gap-1.5 rounded-2xl rounded-bl-md bg-[var(--rem-surface)] px-[18px] py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.35)]"
              : "hidden"
          }
          aria-hidden={!typing}
        >
          <span className="rem-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--rem-accent)]" />
          <span className="rem-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--rem-accent)]" />
          <span className="rem-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--rem-accent)]" />
        </div>
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
