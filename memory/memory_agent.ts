import type { MemoryRepository } from "./memory_repository";
import type { Memory } from "./memory_store";
import { createLogger } from "../infra/logger";
import { isSystemMemoryKey } from "./relationship_state";
import type { SlowBrainSnapshot } from "../brains/slow_brain_store";

const logger = createLogger("memory_agent");

export type { Memory };

export interface RetrievePromptMemoryOptions {
  userMessage: string;
  slowBrainSnapshot?: SlowBrainSnapshot | null;
  maxEntries?: number;
}

interface MemoryPattern {
  pattern: RegExp;
  key: string;
  isNegative?: boolean;
}

const PATTERNS: MemoryPattern[] = [
  { pattern: /我(?:叫|的名字是)\s*([^\s，。！？,.!?]+)/, key: "名字" },
  { pattern: /我住在\s*([^\s，。！？,.!?]+)/, key: "城市" },
  { pattern: /我在\s*([^\s，。！？,.!?]+)\s*住/, key: "城市" },
  { pattern: /我(?:今年|)\s*(\d+)\s*岁/, key: "年龄" },
  { pattern: /我的工作是\s*([^\s，。！？,.!?]+)/, key: "工作" },
  { pattern: /我是(?:做|干)\s*(.+?)(?:的|[，。！？,.!?]|$)/, key: "工作" },
  { pattern: /我喜欢\s*(.+?)(?:[，。！？,.!?]|$)/, key: "喜好" },
  { pattern: /我不喜欢\s*(.+?)(?:[，。！？,.!?]|$)/, key: "不喜好", isNegative: true },
  { pattern: /我讨厌\s*(.+?)(?:[，。！？,.!?]|$)/, key: "不喜好", isNegative: true },
  { pattern: /我(?:有|养了?)(?:一?只|一?条)?\s*([^\s，。！？,.!?猫狗鸟鱼]+[猫狗鸟鱼]?)/, key: "宠物" },
  { pattern: /我的?(?:猫|狗|宠物)叫?\s*([^\s，。！？,.!?]+)/, key: "宠物名字" },
  { pattern: /我每天\s*([^\s，。！？,.!?]+)/, key: "日常习惯" },
  { pattern: /我(?:家人|家里|爸爸|妈妈|老爸|老妈|哥|姐|弟|妹)/, key: "家庭" },
  { pattern: /我来自\s*([^\s，。！？,.!?]+)/, key: "故乡" },
  { pattern: /我的老家在\s*([^\s，。！？,.!?]+)/, key: "故乡" },
  { pattern: /我(?:的?专业|学的?是)\s*([^\s，。！？,.!?]+)/, key: "专业" },
  { pattern: /我在\s*([^\s，。！？,.!?]+)\s*(?:上学|读书|念书)/, key: "学校" },
];

const NEGATION_WORDS = ["不", "没有", "别", "不是", "没"];
const CORE_FACT_KEYS = new Set([
  "名字",
  "城市",
  "工作",
  "学校",
  "宠物",
  "喜好",
]);
const CORE_FACT_LIMIT = 2;
const STOP_WORDS = new Set([
  "我们",
  "你们",
  "他们",
  "这个",
  "那个",
  "现在",
  "最近",
  "刚才",
  "还是",
  "已经",
  "真的",
  "有点",
  "一下",
  "因为",
  "所以",
  "可以",
  "今天",
  "昨天",
  "晚上",
]);

function hasNegationBeforeMatch(msg: string, matchIndex: number): boolean {
  const beforeMatch = msg.slice(0, matchIndex);
  return NEGATION_WORDS.some((neg) => beforeMatch.includes(neg));
}

export function extractMemory(userMessage: string, repo: MemoryRepository): void {
  for (const { pattern, key, isNegative } of PATTERNS) {
    const match = userMessage.match(pattern);
    if (match?.[0] && match?.[1]) {
      if (!isNegative && hasNegationBeforeMatch(userMessage, match.index || 0)) {
        continue;
      }
      const value = match[1].trim();
      if (value) {
        void repo.upsert(key, value);
        logger.info("记住了", { key, value });
      }
    }
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ")
    .trim();
}

function extractKeywords(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const raw = normalized.split(/\s+/);
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const token of raw) {
    const trimmed = token.trim();
    if (trimmed.length < 2 || STOP_WORDS.has(trimmed)) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      keywords.push(trimmed);
    }
    if (/^[\u4e00-\u9fff]{4,}$/.test(trimmed)) {
      for (let size = 2; size <= 3; size++) {
        for (let i = 0; i + size <= trimmed.length; i++) {
          const slice = trimmed.slice(i, i + size);
          if (STOP_WORDS.has(slice) || seen.has(slice)) continue;
          seen.add(slice);
          keywords.push(slice);
        }
      }
    }
  }

  return keywords;
}

function buildRelationshipTexts(slowBrainSnapshot?: SlowBrainSnapshot | null): {
  summaryText: string;
  combinedText: string;
  keywords: string[];
} {
  if (!slowBrainSnapshot) {
    return { summaryText: "", combinedText: "", keywords: [] };
  }

  const parts = [
    slowBrainSnapshot.conversationSummary,
    ...slowBrainSnapshot.relationship.preferredTopics,
    ...slowBrainSnapshot.proactiveTopics,
    ...slowBrainSnapshot.sharedMoments
      .slice(0, 3)
      .map((entry) => `${entry.topic} ${entry.summary} ${entry.hook}`.trim()),
    ...slowBrainSnapshot.topicHistory
      .slice()
      .sort((a, b) => b.lastTurn - a.lastTurn || b.depth - a.depth)
      .slice(0, 4)
      .map((entry) => entry.topic),
    ...slowBrainSnapshot.moodTrajectory.slice(-4).map((entry) => entry.mood),
  ].filter(Boolean);

  const combinedText = parts.join(" ");
  return {
    summaryText: slowBrainSnapshot.conversationSummary,
    combinedText,
    keywords: extractKeywords(combinedText),
  };
}

function keywordOverlapScore(
  haystack: string,
  keywords: string[],
  weight: number,
  maxScore: number,
): number {
  let score = 0;
  for (const keyword of keywords) {
    if (!keyword || keyword.length < 2) continue;
    if (haystack.includes(keyword)) {
      score += weight;
      if (score >= maxScore) return maxScore;
    }
  }
  return score;
}

function scoreMemoryEntry(
  entry: Memory,
  userText: string,
  userKeywords: string[],
  relationshipText: string,
  relationshipKeywords: string[],
): number {
  const keyText = normalizeText(entry.key);
  const valueText = normalizeText(entry.value);
  const combined = `${keyText} ${valueText}`.trim();
  let score = 0;

  if (valueText && userText.includes(valueText)) score += 12;
  if (keyText && userText.includes(keyText)) score += 6;
  score += keywordOverlapScore(combined, userKeywords, 4, 12);

  if (relationshipText) {
    if (valueText && relationshipText.includes(valueText)) score += 8;
    if (keyText && relationshipText.includes(keyText)) score += 3;
    score += keywordOverlapScore(combined, relationshipKeywords, 2, 8);
  }

  return score;
}

function scoreSharedMoment(
  summary: string,
  topic: string,
  hook: string,
  userText: string,
  userKeywords: string[],
  relationshipText: string,
  relationshipKeywords: string[],
): number {
  const combined = normalizeText(`${summary} ${topic} ${hook}`);
  let score = 0;

  if (userText && combined.includes(userText)) score += 8;
  score += keywordOverlapScore(combined, userKeywords, 5, 15);
  if (relationshipText) {
    score += keywordOverlapScore(combined, relationshipKeywords, 2, 8);
  }

  return score;
}

function sortEntries(
  a: { entry: Memory; score: number; importance: number; lastAccessedAt: number; createdAt: number },
  b: { entry: Memory; score: number; importance: number; lastAccessedAt: number; createdAt: number },
): number {
  return (
    b.score - a.score ||
    b.importance - a.importance ||
    b.lastAccessedAt - a.lastAccessedAt ||
    b.createdAt - a.createdAt
  );
}

function buildEpisodePromptMemory(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
  userMessage: string,
  maxEntries: number,
): Memory[] {
  if (!slowBrainSnapshot || maxEntries <= 0) return [];
  if (!slowBrainSnapshot.sharedMoments?.length) return [];

  const userText = normalizeText(userMessage);
  const userKeywords = extractKeywords(userMessage);
  const relationship = buildRelationshipTexts(slowBrainSnapshot);

  return slowBrainSnapshot.sharedMoments
    .map((entry) => ({
      entry,
      score: scoreSharedMoment(
        entry.summary,
        entry.topic,
        entry.hook,
        userText,
        userKeywords,
        normalizeText(relationship.combinedText),
        relationship.keywords,
      ),
    }))
    .sort((a, b) => b.score - a.score || b.entry.turn - a.entry.turn || b.entry.createdAt - a.entry.createdAt)
    .filter((item) => item.score > 0 || userMessage.trim().length <= 12)
    .slice(0, Math.min(2, maxEntries))
    .map((item, index) => ({
      key: index === 0 ? "最近共同经历" : `共同经历${index + 1}`,
      value: item.entry.summary,
    }));
}

/**
 * Prompt-facing retrieval: returns a small, relationship-aware fact set.
 * This is the main prompt retrieval path and intentionally avoids getAll-style flooding.
 */
export async function retrievePromptMemory(
  repo: MemoryRepository,
  options: RetrievePromptMemoryOptions,
): Promise<Memory[]> {
  const maxEntries =
    options.maxEntries ??
    parsePositiveInt(process.env.MAX_PROMPT_MEMORY_ENTRIES, 6);
  if (maxEntries <= 0) return [];

  const entries = (await repo.getAll())
    .filter(({ key }) => !isSystemMemoryKey(key))
    .map((entry) => ({
      entry: { key: entry.key, value: entry.value },
      importance: entry.importance,
      lastAccessedAt: entry.lastAccessedAt,
      createdAt: entry.createdAt,
    }));

  const seenKeys = new Set<string>();
  const selected: Memory[] = [];
  const userText = normalizeText(options.userMessage);
  const userKeywords = extractKeywords(options.userMessage);
  const relationship = buildRelationshipTexts(options.slowBrainSnapshot);
  const relevantCandidates = entries.map((item) => ({
    ...item,
    score: scoreMemoryEntry(
      item.entry,
      userText,
      userKeywords,
      normalizeText(relationship.combinedText),
      relationship.keywords,
    ),
  }));

  const coreFacts = relevantCandidates
    .filter(({ entry }) => CORE_FACT_KEYS.has(entry.key))
    .sort(sortEntries)
    .slice(0, Math.min(CORE_FACT_LIMIT, maxEntries));

  for (const item of coreFacts) {
    seenKeys.add(item.entry.key);
    selected.push(item.entry);
  }

  if (selected.length < maxEntries) {
    const promptEpisodes = buildEpisodePromptMemory(
      options.slowBrainSnapshot,
      options.userMessage,
      maxEntries - selected.length,
    );

    for (const episode of promptEpisodes) {
      if (selected.length >= maxEntries) break;
      if (seenKeys.has(episode.key)) continue;
      seenKeys.add(episode.key);
      selected.push(episode);
    }
  }

  if (selected.length < maxEntries) {
    const relevant = relevantCandidates
      .filter((item) => item.score > 0 && !seenKeys.has(item.entry.key))
      .sort(sortEntries);

    for (const item of relevant) {
      if (selected.length >= maxEntries) break;
      seenKeys.add(item.entry.key);
      selected.push(item.entry);
    }
  }

  if (selected.length < maxEntries) {
    const fallback = relevantCandidates
      .filter((item) => !seenKeys.has(item.entry.key))
      .map((item) => ({ ...item, score: 0 }))
      .sort(sortEntries);

    for (const item of fallback) {
      if (selected.length >= maxEntries) break;
      seenKeys.add(item.entry.key);
      selected.push(item.entry);
    }
  }

  logger.debug("prompt memory retrieved", {
    selected: selected.map((entry) => entry.key),
    totalEntries: entries.length,
    maxEntries,
    relationshipSummary: relationship.summaryText.slice(0, 80),
  });

  return selected;
}

/**
 * Compatibility helper for non-prompt callers.
 * This keeps the old behavior for tests and auxiliary tooling.
 */
export async function retrieveMemory(repo: MemoryRepository): Promise<Memory[]> {
  const entries = await repo.getAll();
  return entries
    .filter(({ key }) => !isSystemMemoryKey(key))
    .map(({ key, value }) => ({ key, value }));
}
