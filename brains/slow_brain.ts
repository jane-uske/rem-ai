// ── Slow Brain ──────────────────────────────────────────────
// Runs asynchronously AFTER Fast Brain finishes streaming.
// Pipeline: local heuristics → LLM deep analysis → state update.
// NEVER blocks the response path.

import { complete, type ChatMessage } from "../llm/qwen_client";
import { extractMemory } from "../memory/memory_agent";
import type { PromptMessage } from "../brain/prompt_builder";
import {
  addFact,
  addInterest,
  addPersonalityNote,
  bumpRelationship,
  touchTopic,
  recordMood,
  setConversationSummary,
  setProactiveTopics,
  synthesizeContext,
} from "./slow_brain_store";

export { synthesizeContext } from "./slow_brain_store";

export interface SlowBrainInput {
  userMessage: string;
  assistantReply: string;
  history: PromptMessage[];
}

// ── Public API ──

export async function runSlowBrain(input: SlowBrainInput): Promise<void> {
  const t0 = Date.now();
  const { userMessage, assistantReply, history } = input;

  // Phase 1: fast local extraction (always runs, ~0ms)
  extractMemory(userMessage);
  localAnalysis(userMessage);

  // Phase 2: LLM deep analysis (async, may take seconds)
  const configured =
    process.env.key && process.env.base_url && process.env.model;

  if (configured) {
    try {
      await llmAnalysis(userMessage, assistantReply, history);
    } catch (err) {
      console.warn(
        "[slow_brain] LLM 分析失败，仅使用本地分析:",
        (err as Error).message,
      );
    }
  }

  // Phase 3: relationship bookkeeping
  updateRelationship(userMessage);

  console.log(`[slow_brain] 分析完成 (${Date.now() - t0}ms)`);
}

// ── Phase 1: Local heuristics (zero-cost) ──

const TOPIC_PATTERNS: { pattern: RegExp; topic: string }[] = [
  { pattern: /工作|上班|公司|老板|同事|加班|摸鱼/, topic: "工作" },
  { pattern: /游戏|打游戏|电竞|手游|steam|switch/, topic: "游戏" },
  { pattern: /电影|电视|动漫|番剧|追剧|漫画/, topic: "影视动漫" },
  { pattern: /吃|美食|餐厅|做饭|烹饪|外卖/, topic: "美食" },
  { pattern: /旅游|旅行|出去玩|度假|出国/, topic: "旅行" },
  { pattern: /学习|考试|作业|学校|大学|论文/, topic: "学习" },
  { pattern: /音乐|歌|听歌|唱歌|演唱会/, topic: "音乐" },
  { pattern: /运动|健身|跑步|锻炼|球/, topic: "运动" },
  { pattern: /猫|狗|宠物|养/, topic: "宠物" },
  { pattern: /感情|恋爱|对象|暧昧|喜欢的人/, topic: "感情" },
];

const MOOD_KEYWORDS: { keywords: string[]; mood: string }[] = [
  { keywords: ["开心", "高兴", "好棒", "太好了", "哈哈", "耶"], mood: "开心" },
  { keywords: ["难过", "伤心", "不开心", "哭", "心痛"], mood: "难过" },
  { keywords: ["烦", "烦死了", "崩溃", "emo", "丧", "累"], mood: "疲惫/烦躁" },
  { keywords: ["紧张", "焦虑", "害怕", "担心"], mood: "焦虑" },
  { keywords: ["无聊", "没意思", "好闲"], mood: "无聊" },
];

function localAnalysis(userMessage: string): void {
  for (const { pattern, topic } of TOPIC_PATTERNS) {
    if (pattern.test(userMessage)) {
      const sentiment = guessSentiment(userMessage);
      touchTopic(topic, sentiment);
    }
  }

  for (const { keywords, mood } of MOOD_KEYWORDS) {
    if (keywords.some((kw) => userMessage.includes(kw))) {
      recordMood(mood);
      return;
    }
  }
  recordMood("平静");
}

function guessSentiment(
  msg: string,
): "positive" | "neutral" | "negative" {
  const pos = ["喜欢", "爱", "好", "棒", "开心", "有趣", "期待"];
  const neg = ["讨厌", "烦", "累", "差", "难", "无聊", "失望"];
  const pScore = pos.filter((w) => msg.includes(w)).length;
  const nScore = neg.filter((w) => msg.includes(w)).length;
  if (pScore > nScore) return "positive";
  if (nScore > pScore) return "negative";
  return "neutral";
}

// ── Phase 2: LLM deep analysis ──

interface LLMAnalysis {
  user_facts?: { key: string; value: string }[];
  interests?: string[];
  personality_note?: string;
  emotional_undertone?: string;
  conversation_summary?: string;
  proactive_topics?: string[];
  relationship_signal?: "warming" | "stable" | "cooling";
}

const ANALYSIS_PROMPT = `你是一个对话分析引擎，不是对话参与者。
分析以下对话片段，提取结构化信息。

严格返回合法 JSON（不要 markdown 代码块），格式如下：
{
  "user_facts": [{"key": "...", "value": "..."}],
  "interests": ["..."],
  "personality_note": "对用户性格的一句话观察，没有明显观察则为空字符串",
  "emotional_undertone": "用户在这段对话中的深层情绪（一两个词）",
  "conversation_summary": "用一两句话概括到目前为止的对话内容和进展",
  "proactive_topics": ["Rem 下次可以主动提起的话题"],
  "relationship_signal": "warming 或 stable 或 cooling"
}

注意：
- user_facts 只提取用户明确提到的事实（姓名、年龄、职业、住所等），不要猜测
- interests 只提取用户表现出兴趣的事物
- conversation_summary 要覆盖整段对话，不只是最后一轮
- proactive_topics 是未来可以自然聊到的话题，基于用户兴趣`;

async function llmAnalysis(
  userMessage: string,
  assistantReply: string,
  history: PromptMessage[],
): Promise<void> {
  const recentHistory = history.slice(-8);
  const historyText = recentHistory
    .map((m) => `${m.role === "user" ? "用户" : "Rem"}：${m.content}`)
    .join("\n");

  const currentTurn = `用户：${userMessage}\nRem：${assistantReply}`;

  const messages: ChatMessage[] = [
    { role: "system", content: ANALYSIS_PROMPT },
    {
      role: "user",
      content: `对话历史：\n${historyText}\n\n最新一轮：\n${currentTurn}`,
    },
  ];

  const raw = await complete(messages, 512);
  const analysis = parseAnalysis(raw);
  if (!analysis) return;

  // Apply extracted facts
  if (analysis.user_facts) {
    for (const { key, value } of analysis.user_facts) {
      if (key && value) addFact(key, value);
    }
  }

  // Apply interests
  if (analysis.interests) {
    for (const interest of analysis.interests) {
      if (interest) addInterest(interest);
    }
  }

  // Apply personality note
  if (analysis.personality_note) {
    addPersonalityNote(analysis.personality_note);
  }

  // Apply emotional undertone as mood
  if (analysis.emotional_undertone) {
    recordMood(analysis.emotional_undertone);
  }

  // Apply conversation summary
  if (analysis.conversation_summary) {
    setConversationSummary(analysis.conversation_summary);
  }

  // Apply proactive topics
  if (analysis.proactive_topics?.length) {
    setProactiveTopics(analysis.proactive_topics);
  }

  // Apply relationship signal
  if (analysis.relationship_signal) {
    const delta =
      analysis.relationship_signal === "warming"
        ? 0.05
        : analysis.relationship_signal === "cooling"
          ? -0.03
          : 0.01;
    bumpRelationship({ emotionalBondDelta: delta });
  }

  console.log(
    "[slow_brain] LLM 分析结果:",
    JSON.stringify(analysis, null, 0).slice(0, 200),
  );
}

function parseAnalysis(raw: string): LLMAnalysis | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as LLMAnalysis;
  } catch {
    console.warn("[slow_brain] JSON 解析失败:", raw.slice(0, 100));
    return null;
  }
}

// ── Phase 3: Relationship bookkeeping ──

function updateRelationship(userMessage: string): void {
  // Every turn bumps familiarity slightly
  bumpRelationship({ familiarityDelta: 0.02 });

  // Emotional sharing increases bond
  const emotionalSharing =
    /我(觉得|感到|心里|内心)|说实话|跟你说|其实/.test(userMessage);
  if (emotionalSharing) {
    bumpRelationship({ emotionalBondDelta: 0.05 });
  }

  // Personal stories increase bond
  if (/我(以前|之前|小时候|年轻|那时|曾经)/.test(userMessage)) {
    bumpRelationship({ emotionalBondDelta: 0.03 });
  }
}
