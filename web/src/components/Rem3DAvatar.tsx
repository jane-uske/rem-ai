"use client";

import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { getEmotionLabel } from "@/lib/emotionLabels";
import { RemVrmViewer, type VrmViewerState } from "@/lib/rem3d/vrmViewer";
import type { AvatarActionCommand, RemState } from "@/types/avatar";

export type Rem3DAvatarProps = {
  /** 与 WebSocket `emotion` 一致：neutral / happy / curious / shy / sad */
  emotion: string;
  remState?: RemState;
  actionSignal?: { action: AvatarActionCommand; nonce: number } | null;
  /** TTS 实时音量包络 0–1（useAudioBase64Queue） */
  lipEnvelopeRef: MutableRefObject<number>;
  /** 是否正在播放 TTS（口型在 Web Audio 不可用时回退） */
  voiceActiveRef?: MutableRefObject<boolean>;
  className?: string;
  /** stage：嵌入大屏舞台；card：独立卡片（默认） */
  variant?: "card" | "stage";
};

/**
 * 网页端 VRM 3D 角色（默认见 `getDefaultVrmUrl()`，可用 NEXT_PUBLIC_VRM_URL 覆盖）。
 */
export function Rem3DAvatar({
  emotion,
  remState = "idle",
  actionSignal = null,
  lipEnvelopeRef,
  voiceActiveRef,
  className = "",
  variant = "card",
}: Rem3DAvatarProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<RemVrmViewer | null>(null);
  const [state, setState] = useState<VrmViewerState>("loading");
  const [err, setErr] = useState<string | null>(null);

  const isStage = variant === "stage";

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const lipRef = lipEnvelopeRef;
    const voiceRef = voiceActiveRef;
    const v = new RemVrmViewer(el, {
      getLipEnvelope: () => lipRef.current,
      getVoiceActive: voiceRef ? () => voiceRef.current : undefined,
      onStateChange: (s, e) => {
        setState(s);
        setErr(s === "error" ? e ?? "load error" : null);
        if (s === "ready") v.startLoop();
      },
    });
    viewerRef.current = v;

    const ro = new ResizeObserver(() => v.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      v.dispose();
      viewerRef.current = null;
    };
  }, [lipEnvelopeRef, voiceActiveRef]);

  useEffect(() => {
    viewerRef.current?.setEmotion(emotion);
  }, [emotion]);

  useEffect(() => {
    viewerRef.current?.setState(remState);
  }, [remState]);

  useEffect(() => {
    if (!actionSignal) return;
    const { action } = actionSignal;
    viewerRef.current?.playAction(
      action.action,
      action.intensity,
      action.duration,
    );
  }, [actionSignal]);

  const shell =
    isStage
      ? "relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-transparent lg:rounded-2xl"
      : "relative flex min-h-[280px] min-w-[260px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl dark:bg-black/20";

  const canvasHost = isStage
    ? "min-h-0 w-full min-w-0 flex-1"
    : "h-[min(42vh,360px)] w-full min-h-[240px]";

  return (
    <div className={`${shell} ${className}`}>
      <div ref={hostRef} className={canvasHost} />

      {state === "loading" && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 text-sm text-[var(--rem-dim)] backdrop-blur-sm">
          加载 3D 模型中…
        </p>
      )}
      {state === "error" && (
        <p className="absolute inset-x-0 bottom-0 bg-[var(--rem-error-bg)]/95 px-3 py-2 text-center text-xs text-[var(--rem-danger)] backdrop-blur-md">
          3D 加载失败：{err}
        </p>
      )}
      {/* stage：情绪在 RemChatApp 顶栏展示，此处不再占画布高度 */}
      {state === "ready" && !isStage && (
        <div className="flex items-center justify-between border-t border-white/10 bg-transparent px-3 py-2 text-xs text-[var(--rem-dim)]">
          <span>当前情绪</span>
          <span className="font-medium text-[var(--rem-accent)]">
            {getEmotionLabel(emotion)}
          </span>
        </div>
      )}
    </div>
  );
}
