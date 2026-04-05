import type { Emotion } from "../emotion/emotion_state";
import { buildCharacterRulesPrompt } from "./character_rules";
import { buildPersonalityPrompt } from "./personality";

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
  neutral: "平静、温柔地回复。",
  happy: "开心地回复，语气轻快、带一点撒娇，可以用「～」「！」。",
  curious: "好奇地回复，语气中带有兴趣和探索欲，会追问细节。",
  shy: "害羞地回复，语气中带有犹豫和「…」，偶尔脸红。",
  sad: "温柔地安慰对方，语气轻柔、体贴，表达共情。",
};

function buildSystemPrompt(
  memory: MemoryEntry[],
  emotion: Emotion,
  priorityContext?: string,
): string {
  const sections: string[] = [];
  const maxPriorityChars = parsePositiveInt(process.env.MAX_PRIORITY_CONTEXT_CHARS, 700);
  const maxMemoryEntries = parsePositiveInt(process.env.MAX_PROMPT_MEMORY_ENTRIES, 6);
  const maxMemoryValueChars = parsePositiveInt(process.env.MAX_PROMPT_MEMORY_VALUE_CHARS, 48);

  if (priorityContext?.trim()) {
    sections.push(
      "【优先参考（请自然融入对话，不要逐条复述）】\n" +
        trimTextByChars(priorityContext.trim(), maxPriorityChars),
    );
  }

  sections.push(
    buildPersonalityPrompt(),
    buildCharacterRulesPrompt(),
    `当前情绪：${emotion}\n情绪表达风格：${EMOTION_STYLE[emotion]}`,
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
}: BuildPromptInput): PromptMessage[] {
  return [
    { role: "system", content: buildSystemPrompt(memory, emotion, priorityContext) },
    ...history,
    { role: "user", content: userMessage },
  ];
}
