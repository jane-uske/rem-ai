import type { Emotion } from "../../avatar/types";
import { SENTENCE_END } from "../../utils/sentence_chunker";

export type TurnTakingState = "HOLD" | "LIKELY_END" | "CONFIRMED_END";

export interface TurnTakingDecisionInput {
  baseGapMs: number;
  previewText: string;
  nowMs: number;
  lastPartialUpdateAt: number;
  lastGrowthAt: number;
  hesitationHoldMs: number;
  growthHoldMs: number;
  likelyStableMs: number;
  confirmedStableMs: number;
  releaseMs: number;
  minGapMs: number;
}

export interface TurnTakingDecision {
  state: TurnTakingState;
  gapMs: number;
  previewText?: string;
  reasons: string[];
  usedFallback: boolean;
  sentenceClosed: boolean;
  semanticallyComplete: boolean;
  incompleteTail: boolean;
  recentGrowth: boolean;
  stableMs: number | null;
}

export interface ThinkingPauseBackchannelInput {
  state: TurnTakingState;
  previewText: string;
  stableMs: number | null;
  recentGrowth: boolean;
  semanticallyComplete: boolean;
  incompleteTail: boolean;
  minStableMs?: number;
  minPreviewChars?: number;
}

export interface BackchannelDecisionInput extends ThinkingPauseBackchannelInput {
  emotion: Emotion;
  cooldownActive?: boolean;
  alreadySentThisTurn?: boolean;
  cooldownStableMs?: number;
}

export interface BackchannelDecision {
  allowed: boolean;
  reason:
    | "turn_state"
    | "already_sent"
    | "cooldown"
    | "preview_short"
    | "recent_growth"
    | "unstable"
    | "semantic_complete"
    | "thinking_pause"
    | "likely_end";
  text?: string;
  thinkingPause: boolean;
}

export interface FallbackNoiseSuppressionInput {
  vadMode?: string | null;
  previewText: string;
  speechDurationMs: number;
  suppressionMaxMs: number;
  utteranceMaxRms?: number;
  minUtteranceRms?: number;
  utteranceFrameCount?: number;
  utteranceStrongFrames?: number;
  minStrongFrames?: number;
  minStrongRatio?: number;
  recognizedText?: string | null;
  tinyTextMaxChars?: number;
}

export interface StrictNoPreviewSuppressionInput {
  vadMode?: string | null;
  previewText: string;
  utteranceFrameCount?: number;
  utteranceStrongFrames?: number;
  minStrongFrames?: number;
  minStrongRatio?: number;
  recognizedText?: string | null;
  tinyTextMaxChars?: number;
}

const PARTIAL_PLACEHOLDER_RE = /^录音中…/;
const TENTATIVE_RE = /^(嗯+|啊+|呃+|额+|唔+|哦+|欸+|诶+|哎+|em+)$/i;
const OPEN_TAIL_RE = /(然后|然后呢|所以|因为|但是|不过|就是|那个|这个|如果|还有|而且|比如|其实|我觉得|我想|我刚|我还|你知道|就是说)\s*$/u;
const SEMANTIC_END_RE = /(吗|呢|吧|了|啦|呀|啊|嘛|么|对吧|是吧|行吗|好吗|可以吗|是不是)\s*[。！？.!?]*$/u;
const CLAUSE_BREAK_RE = /[，,；;：:]/u;
const CLAUSE_TAIL_RE = /[，,；;：:]\s*$/u;
const CONTINUATION_CUES = [
  "但是",
  "然后",
  "因为",
  "不过",
  "我觉得",
  "我想",
  "其实",
  "不确定",
  "我不确定",
] as const;

export function endsWithSentencePunctuation(text: string): boolean {
  return new RegExp(`${SENTENCE_END.source}\\s*$`).test(text);
}

export function normalizeSpeechText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, "")
    .replace(/[，。！？,.!?、；;：“”"'`~·…\-]/g, "");
}

export function isTentativeSpeechText(text: string): boolean {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return false;

  if (TENTATIVE_RE.test(normalized)) {
    return true;
  }

  return [
    "这个",
    "那个",
    "等下",
    "等一下",
    "等等",
    "稍等",
    "我想想",
    "我想一下",
    "让我想想",
    "先想想",
    "我先想想",
    "容我想想",
    "想一下",
  ].includes(normalized);
}

export function getMeaningfulTurnPreview(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || PARTIAL_PLACEHOLDER_RE.test(trimmed)) {
    return "";
  }
  return trimmed;
}

export function shouldSuppressFallbackNoiseUtterance(
  input: FallbackNoiseSuppressionInput,
): boolean {
  if (input.vadMode !== "fallback_energy") return false;
  if (getMeaningfulTurnPreview(input.previewText)) return false;
  const weakDuration = input.speechDurationMs < input.suppressionMaxMs;
  const weakRms = (input.utteranceMaxRms ?? 0) < (input.minUtteranceRms ?? 0.035);
  const totalFrames = Math.max(0, Math.floor(input.utteranceFrameCount ?? 0));
  const strongFrames = Math.max(0, Math.floor(input.utteranceStrongFrames ?? 0));
  const minStrongFrames = Math.max(1, Math.floor(input.minStrongFrames ?? 2));
  const minStrongRatio = Math.max(0, Math.min(1, input.minStrongRatio ?? 0.08));
  const weakShape =
    strongFrames < minStrongFrames || strongFrameRatio(totalFrames, strongFrames) < minStrongRatio;
  if (!input.recognizedText) {
    return (weakDuration && weakRms) || (weakRms && weakShape);
  }

  const compact = input.recognizedText
    .replace(/\s+/g, "")
    .replace(/[，。！？!?、,.~～…:：;；"'`“”‘’\-—_]/gu, "");
  const tinyText = compact.length > 0 && compact.length <= (input.tinyTextMaxChars ?? 1);
  return (weakRms && weakShape) || ((weakDuration || weakShape) && weakRms && tinyText);
}

export function strongFrameRatio(totalFrames: number, strongFrames: number): number {
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) return 0;
  if (!Number.isFinite(strongFrames) || strongFrames <= 0) return 0;
  return Math.max(0, Math.min(1, strongFrames / totalFrames));
}

export function shouldSuppressStrictNoPreviewUtterance(
  input: StrictNoPreviewSuppressionInput,
): boolean {
  if (input.vadMode !== "strict") return false;
  if (getMeaningfulTurnPreview(input.previewText)) return false;

  const totalFrames = Math.max(0, Math.floor(input.utteranceFrameCount ?? 0));
  const strongFrames = Math.max(0, Math.floor(input.utteranceStrongFrames ?? 0));
  const minStrongFrames = Math.max(1, Math.floor(input.minStrongFrames ?? 8));
  const minStrongRatio = Math.max(0, Math.min(1, input.minStrongRatio ?? 0.22));
  const ratio = strongFrameRatio(totalFrames, strongFrames);
  const weakShape = strongFrames < minStrongFrames || ratio < minStrongRatio;

  if (!input.recognizedText) {
    return weakShape;
  }

  const compact = input.recognizedText
    .replace(/\s+/g, "")
    .replace(/[，。！？!?、,.~～…:：;；"'`“”‘’\-—_]/gu, "");
  const tinyText = compact.length > 0 && compact.length <= (input.tinyTextMaxChars ?? 5);
  return weakShape && tinyText;
}

export function shouldOfferThinkingPauseBackchannel(
  input: ThinkingPauseBackchannelInput,
): boolean {
  if (input.state !== "HOLD") return false;
  const preview = getMeaningfulTurnPreview(input.previewText);
  const minPreviewChars = Math.max(1, Math.floor(input.minPreviewChars ?? 6));
  const stableMs = input.stableMs ?? 0;
  const minStableMs = Math.max(0, Math.floor(input.minStableMs ?? 1100));

  if (!preview || preview.length < minPreviewChars) return false;
  if (isTentativeSpeechText(preview)) return false;
  if (input.recentGrowth) return false;
  if (stableMs < minStableMs) return false;
  if (input.semanticallyComplete && !input.incompleteTail) return false;

  return input.incompleteTail || !input.semanticallyComplete;
}

export function chooseBackchannelText(emotion: Emotion, thinkingPause: boolean): string {
  if (!thinkingPause) return "嗯";
  switch (emotion) {
    case "happy":
      return "你继续";
    case "curious":
      return "然后呢";
    case "shy":
      return "嗯…你继续";
    case "sad":
      return "我在听";
    case "neutral":
    default:
      return "我在听";
  }
}

export function evaluateBackchannelDecision(
  input: BackchannelDecisionInput,
): BackchannelDecision {
  if (input.alreadySentThisTurn) {
    return { allowed: false, reason: "already_sent", thinkingPause: false };
  }
  if (input.cooldownActive) {
    return { allowed: false, reason: "cooldown", thinkingPause: false };
  }

  const preview = getMeaningfulTurnPreview(input.previewText);
  const minPreviewChars = Math.max(1, Math.floor(input.minPreviewChars ?? 6));
  if (!preview || preview.length < minPreviewChars) {
    return { allowed: false, reason: "preview_short", thinkingPause: false };
  }
  if (input.recentGrowth) {
    return { allowed: false, reason: "recent_growth", thinkingPause: false };
  }

  const stableMs = input.stableMs ?? 0;
  const cooldownStableMs = Math.max(0, Math.floor(input.cooldownStableMs ?? 1100));
  const thinkingPause = shouldOfferThinkingPauseBackchannel({
    state: input.state,
    previewText: preview,
    stableMs,
    recentGrowth: input.recentGrowth,
    semanticallyComplete: input.semanticallyComplete,
    incompleteTail: input.incompleteTail,
    minStableMs: cooldownStableMs,
    minPreviewChars,
  });
  if (thinkingPause) {
    return {
      allowed: true,
      reason: "thinking_pause",
      text: chooseBackchannelText(input.emotion, true),
      thinkingPause: true,
    };
  }

  if (input.state !== "LIKELY_END") {
    return { allowed: false, reason: "turn_state", thinkingPause: false };
  }
  if (stableMs < cooldownStableMs) {
    return { allowed: false, reason: "unstable", thinkingPause: false };
  }
  if (!/[吗呢吧了啦呀啊嘛么。！？!?]$/u.test(preview)) {
    return { allowed: false, reason: "semantic_complete", thinkingPause: false };
  }

  return {
    allowed: true,
    reason: "likely_end",
    text: chooseBackchannelText(input.emotion, false),
    thinkingPause: false,
  };
}

function hasIncompleteTail(text: string): boolean {
  return OPEN_TAIL_RE.test(text.trim());
}

function hasClauseBreakTail(text: string): boolean {
  return CLAUSE_TAIL_RE.test(text.trim());
}

function hasContinuationCue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const clauses = trimmed.split(CLAUSE_BREAK_RE);
  const trailingClause = (clauses[clauses.length - 1] || "").trim();
  const recentWindow = trimmed.slice(Math.max(0, trimmed.length - 18));

  return CONTINUATION_CUES.some((cue) =>
    trailingClause.startsWith(cue) || recentWindow.includes(cue),
  );
}

function isSemanticallyComplete(text: string): boolean {
  const trimmed = text.trim();
  return endsWithSentencePunctuation(trimmed) || SEMANTIC_END_RE.test(trimmed);
}

export function decideTurnTaking(input: TurnTakingDecisionInput): TurnTakingDecision {
  const previewText = getMeaningfulTurnPreview(input.previewText);
  const reasons: string[] = [];

  if (!previewText) {
    return {
      state: "CONFIRMED_END",
      gapMs: input.baseGapMs,
      reasons: ["fallback:no_partial"],
      usedFallback: true,
      sentenceClosed: false,
      semanticallyComplete: false,
      incompleteTail: false,
      recentGrowth: false,
      stableMs: null,
    };
  }

  if (isTentativeSpeechText(previewText)) {
    return {
      state: "HOLD",
      gapMs: Math.max(input.baseGapMs, input.hesitationHoldMs),
      previewText,
      reasons: ["tentative_partial"],
      usedFallback: false,
      sentenceClosed: false,
      semanticallyComplete: false,
      incompleteTail: false,
      recentGrowth: false,
      stableMs: input.lastPartialUpdateAt > 0 ? Math.max(0, input.nowMs - input.lastPartialUpdateAt) : null,
    };
  }

  const stableMs =
    input.lastPartialUpdateAt > 0 ? Math.max(0, input.nowMs - input.lastPartialUpdateAt) : null;
  const recentGrowth =
    input.lastGrowthAt > 0 && Math.max(0, input.nowMs - input.lastGrowthAt) < input.likelyStableMs;
  const sentenceClosed = endsWithSentencePunctuation(previewText);
  const incompleteTail = hasIncompleteTail(previewText);
  const clauseBreakTail = hasClauseBreakTail(previewText);
  const semanticallyComplete = isSemanticallyComplete(previewText);
  const continuationCue = hasContinuationCue(previewText);

  if (recentGrowth) reasons.push("recent_growth");
  if (incompleteTail) reasons.push("open_clause_tail");
  if (clauseBreakTail) reasons.push("clause_break_tail");
  if (continuationCue) reasons.push("continuation_cue");
  if (sentenceClosed) reasons.push("sentence_punctuation");
  else if (semanticallyComplete) reasons.push("semantic_end_cue");

  if (
    incompleteTail ||
    clauseBreakTail ||
    recentGrowth ||
    (continuationCue && !semanticallyComplete)
  ) {
    return {
      state: "HOLD",
      gapMs: Math.max(input.baseGapMs, input.growthHoldMs),
      previewText,
      reasons,
      usedFallback: false,
      sentenceClosed,
      semanticallyComplete,
      incompleteTail,
      recentGrowth,
      stableMs,
    };
  }

  if (sentenceClosed && stableMs !== null && stableMs >= input.confirmedStableMs) {
    return {
      state: "CONFIRMED_END",
      gapMs: Math.max(input.minGapMs, input.baseGapMs - input.releaseMs),
      previewText,
      reasons,
      usedFallback: false,
      sentenceClosed,
      semanticallyComplete,
      incompleteTail,
      recentGrowth,
      stableMs,
    };
  }

  if (semanticallyComplete) {
    if (stableMs === null || stableMs < input.likelyStableMs) {
      return {
        state: "HOLD",
        gapMs: Math.max(input.baseGapMs, input.growthHoldMs),
        previewText,
        reasons: reasons.length ? reasons : ["semantic_end_not_stable"],
        usedFallback: false,
        sentenceClosed,
        semanticallyComplete,
        incompleteTail,
        recentGrowth,
        stableMs,
      };
    }

    return {
      state: stableMs !== null && stableMs >= input.confirmedStableMs ? "CONFIRMED_END" : "LIKELY_END",
      gapMs:
        stableMs !== null && stableMs >= input.confirmedStableMs
          ? Math.max(input.minGapMs, input.baseGapMs - input.releaseMs)
          : Math.max(
              input.minGapMs,
              input.baseGapMs -
                (input.baseGapMs >= 200
                  ? Math.floor(input.releaseMs / 2)
                  : input.releaseMs),
            ),
      previewText,
      reasons,
      usedFallback: false,
      sentenceClosed,
      semanticallyComplete,
      incompleteTail,
      recentGrowth,
      stableMs,
    };
  }

  if (stableMs === null || stableMs < input.confirmedStableMs) {
    return {
      state: "HOLD",
      gapMs: Math.max(input.baseGapMs, input.growthHoldMs),
      previewText,
      reasons: reasons.length ? reasons : ["incomplete_clause_not_stable"],
      usedFallback: false,
      sentenceClosed,
      semanticallyComplete,
      incompleteTail,
      recentGrowth,
      stableMs,
    };
  }

  return {
    state: "LIKELY_END",
    gapMs: input.baseGapMs,
    previewText,
    reasons: reasons.length ? reasons : ["stable_partial_without_semantic_close"],
    usedFallback: false,
    sentenceClosed,
    semanticallyComplete,
    incompleteTail,
    recentGrowth,
    stableMs,
  };
}
