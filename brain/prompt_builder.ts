import type { Emotion } from "../emotion/emotion_state";
import { buildCharacterRulesPrompt } from "./character_rules";
import { buildPersonalityPrompt } from "./personality";
import type { PersonaState } from "../persona";
import { buildPersonaPrompt } from "../persona";

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface MemoryEntry {
  key: string;
  value: string;
}

interface BuildPromptInput {
  memory: MemoryEntry[];
  emotion: Emotion;
  history: PromptMessage[];
  userMessage: string;
  /** 慢脑画像、对话策略等，置于 system 最前以便模型优先注意 */
  priorityContext?: string;
  /** Optional structured persona state for v1 personality system */
  persona?: PersonaState;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function trimTextByChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

const EMOTION_STYLE: Record<Emotion, string> = {
  neutral: "平静、温柔地回复，句子自然，不用刻意卖萌或夸张。",
  happy: "开心地回复，语气轻快、明亮，能明显听出雀跃感，可以自然用「～」「！」，但不要失控。",
  curious: "好奇地回复，语气里带着兴趣和探索欲，适合轻追问、轻确认，让人感觉你在认真跟进。",
  shy: "害羞地回复，语气稍微轻、慢一点，句子可以更短，偶尔带一点停顿或「…」，像在斟酌要不要说出口。",
  sad: "带一点低落、委屈或柔软地回复，语气更轻、更慢，避免兴奋式表达，但仍然要自然、真诚。",
};

const EMOTION_SPEECH_STYLE: Record<Emotion, string> = {
  neutral: "说话节奏均匀，停顿自然，起句和收句都偏稳。",
  happy: "起句更快一点，句中停顿更短，收尾更上扬，适合用更短更亮的表达。",
  curious: "句尾可以稍微上挑，适合在关键点前后稍停一下，像在等对方继续说。",
  shy: "起句略慢，句中停顿略多，尾音更轻，像是边想边说。",
  sad: "整体更慢一点，停顿更柔和，句尾更收，像在轻声把话说完。",
};

function buildEmotionSpeechGuidance(emotion: Emotion): string {
  return `当前情绪：${emotion}\n情绪表达风格：${EMOTION_STYLE[emotion]}\n说话节奏提示：${EMOTION_SPEECH_STYLE[emotion]}`;
}

function buildSystemPrompt(
  memory: MemoryEntry[],
  emotion: Emotion,
  priorityContext?: string,
  persona?: PersonaState,
): string {
  const maxPriorityChars = parsePositiveInt(process.env.MAX_PRIORITY_CONTEXT_CHARS, 700);
  const maxMemoryEntries = parsePositiveInt(process.env.MAX_PROMPT_MEMORY_ENTRIES, 6);
  const maxMemoryValueChars = parsePositiveInt(process.env.MAX_PROMPT_MEMORY_VALUE_CHARS, 48);

  // Use new persona system if provided
  if (persona) {
    const memoryStr = memory.length > 0
      ? memory
          .slice(0, maxMemoryEntries)
          .map((m) => `- ${m.key}：${trimTextByChars(m.value, maxMemoryValueChars)}`)
          .join("\n")
      : undefined;
    return buildPersonaPrompt(persona, {
      priorityContext: priorityContext?.trim()
        ? trimTextByChars(priorityContext.trim(), maxPriorityChars)
        : undefined,
      memoryStr,
      emotionSpeechGuidance: buildEmotionSpeechGuidance(emotion),
    });
  }

  // Fallback to original system prompt logic
  const sections: string[] = [];

  if (priorityContext?.trim()) {
    sections.push(
      "【优先参考（请自然融入对话，不要逐条复述）】\n" +
        trimTextByChars(priorityContext.trim(), maxPriorityChars),
    );
  }

  sections.push(
    buildPersonalityPrompt(),
    buildCharacterRulesPrompt(),
    buildEmotionSpeechGuidance(emotion),
    "用中文回复。",
  );

  if (memory.length > 0) {
    const memoryLines = memory
      .slice(0, maxMemoryEntries)
      .map((m) => `- ${m.key}：${trimTextByChars(m.value, maxMemoryValueChars)}`)
      .join("\n");
    sections.push(`用户信息：\n${memoryLines}`);
  }

  return sections.join("\n\n");
}

export function buildPrompt({
  memory,
  emotion,
  history,
  userMessage,
  priorityContext,
  persona,
}: BuildPromptInput): PromptMessage[] {
  return [
    { role: "system", content: buildSystemPrompt(memory, emotion, priorityContext, persona) },
    ...history,
    { role: "user", content: userMessage },
  ];
}
