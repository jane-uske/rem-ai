"use client";

import { Avatar } from "@/components/Avatar";
import { ChatWindow } from "@/components/ChatWindow";
import { InputBar } from "@/components/InputBar";
import { VoiceIndicator } from "@/components/VoiceIndicator";
import { useRemChat } from "@/hooks/useRemChat";

export function RemChatApp() {
  const {
    emotion,
    connected,
    connLabel,
    messages,
    streamingText,
    thinkingHint,
    waiting,
    inputPlaceholder,
    recording,
    voiceActive,
    hasMic,
    sendText,
    toggleMic,
  } = useRemChat();

  const inputDisabled = !connected || waiting || recording;
  const micDisabled = !connected || !hasMic;

  return (
    <div className="mx-auto flex h-[100dvh] max-w-2xl flex-col bg-[var(--background)]">
      <header className="shrink-0 border-b border-[var(--rem-border)] bg-[var(--rem-surface)]">
        <div className="flex items-center gap-2.5 px-4 pt-2.5 text-sm text-[var(--rem-dim)]">
          <span className="font-semibold text-[var(--foreground)]">Rem</span>
          <span
            className={
              connected
                ? "h-2 w-2 rounded-full bg-[#5ecc7b]"
                : "h-2 w-2 rounded-full bg-[var(--rem-dot-off)]"
            }
            aria-hidden
          />
          <span>{connLabel}</span>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <Avatar emotion={emotion} />
          <VoiceIndicator active={voiceActive} />
        </div>
      </header>

      <ChatWindow
        messages={messages}
        streamingText={streamingText}
        thinkingHint={thinkingHint}
      />

      <footer className="shrink-0 border-t border-[var(--rem-border)] bg-[var(--rem-surface)] px-4 py-3">
        <InputBar
          onSend={sendText}
          onMicToggle={toggleMic}
          disabled={inputDisabled}
          micDisabled={micDisabled}
          recording={recording}
          placeholder={inputPlaceholder}
        />
      </footer>
    </div>
  );
}
