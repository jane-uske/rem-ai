// ── Slow Brain State Store ──────────────────────────────────
// Holds structured long-term observations that accumulate across turns.
// Fast Brain reads a synthesized snapshot before each reply.

export interface UserProfile {
  facts: Map<string, string>;
  interests: string[];
  personalityNotes: string[];
}

export interface RelationshipState {
  familiarity: number;      // 0 → 1, grows with interaction
  emotionalBond: number;    // 0 → 1, grows when user shares feelings
  turnCount: number;
  preferredTopics: string[];
}

export interface TopicEntry {
  topic: string;
  depth: number;            // how many turns touched this topic
  lastTurn: number;
  sentiment: "positive" | "neutral" | "negative";
}

export interface MoodSnapshot {
  turn: number;
  mood: string;
}

export interface SlowBrainSnapshot {
  userProfile: UserProfile;
  relationship: RelationshipState;
  topicHistory: TopicEntry[];
  moodTrajectory: MoodSnapshot[];
  conversationSummary: string;
  proactiveTopics: string[];
}

// ── Singleton state ──

const profile: UserProfile = {
  facts: new Map(),
  interests: [],
  personalityNotes: [],
};

const relationship: RelationshipState = {
  familiarity: 0,
  emotionalBond: 0,
  turnCount: 0,
  preferredTopics: [],
};

const topicHistory: TopicEntry[] = [];
const moodTrajectory: MoodSnapshot[] = [];
let conversationSummary = "";
let proactiveTopics: string[] = [];

// ── Writers ──

export function addFact(key: string, value: string): void {
  profile.facts.set(key, value);
}

export function addInterest(interest: string): void {
  if (!profile.interests.includes(interest)) {
    profile.interests.push(interest);
  }
}

export function addPersonalityNote(note: string): void {
  if (profile.personalityNotes.length >= 5) {
    profile.personalityNotes.shift();
  }
  if (!profile.personalityNotes.includes(note)) {
    profile.personalityNotes.push(note);
  }
}

export function bumpRelationship(opts: {
  familiarityDelta?: number;
  emotionalBondDelta?: number;
}): void {
  relationship.turnCount++;
  if (opts.familiarityDelta) {
    relationship.familiarity = clamp01(
      relationship.familiarity + opts.familiarityDelta,
    );
  }
  if (opts.emotionalBondDelta) {
    relationship.emotionalBond = clamp01(
      relationship.emotionalBond + opts.emotionalBondDelta,
    );
  }
}

export function touchTopic(
  topic: string,
  sentiment: TopicEntry["sentiment"] = "neutral",
): void {
  const existing = topicHistory.find((t) => t.topic === topic);
  if (existing) {
    existing.depth++;
    existing.lastTurn = relationship.turnCount;
    existing.sentiment = sentiment;
  } else {
    topicHistory.push({
      topic,
      depth: 1,
      lastTurn: relationship.turnCount,
      sentiment,
    });
  }

  if (
    !relationship.preferredTopics.includes(topic) &&
    (existing?.depth ?? 0) >= 2
  ) {
    relationship.preferredTopics.push(topic);
  }
}

export function recordMood(mood: string): void {
  moodTrajectory.push({ turn: relationship.turnCount, mood });
  if (moodTrajectory.length > 20) moodTrajectory.shift();
}

export function setConversationSummary(summary: string): void {
  conversationSummary = summary;
}

export function setProactiveTopics(topics: string[]): void {
  proactiveTopics = topics.slice(0, 5);
}

// ── Reader ──

export function getSnapshot(): SlowBrainSnapshot {
  return {
    userProfile: {
      facts: new Map(profile.facts),
      interests: [...profile.interests],
      personalityNotes: [...profile.personalityNotes],
    },
    relationship: { ...relationship },
    topicHistory: topicHistory.map((t) => ({ ...t })),
    moodTrajectory: [...moodTrajectory],
    conversationSummary,
    proactiveTopics: [...proactiveTopics],
  };
}

/**
 * Synthesize the snapshot into a structured prompt section
 * that Fast Brain injects into its system message.
 */
export function synthesizeContext(): string | undefined {
  const sections: string[] = [];

  // User profile
  if (profile.facts.size > 0 || profile.interests.length > 0) {
    const lines: string[] = [];
    for (const [k, v] of profile.facts) lines.push(`${k}：${v}`);
    if (profile.interests.length > 0)
      lines.push(`兴趣爱好：${profile.interests.join("、")}`);
    sections.push(`【用户画像】\n${lines.join("\n")}`);
  }

  // Personality notes
  if (profile.personalityNotes.length > 0) {
    sections.push(
      `【性格观察】\n${profile.personalityNotes.map((n) => `- ${n}`).join("\n")}`,
    );
  }

  // Relationship
  if (relationship.turnCount > 0) {
    const level = relationship.familiarity > 0.6
      ? "已经很熟了"
      : relationship.familiarity > 0.3
        ? "逐渐熟悉中"
        : "刚认识不久";
    const bond = relationship.emotionalBond > 0.5
      ? "，用户比较信任你" : "";
    sections.push(`【关系状态】${level}（聊了 ${relationship.turnCount} 轮）${bond}`);
  }

  // Active topics
  const recentTopics = topicHistory
    .filter((t) => t.lastTurn >= relationship.turnCount - 3)
    .sort((a, b) => b.depth - a.depth);
  if (recentTopics.length > 0) {
    const topicLines = recentTopics.map(
      (t) => `- ${t.topic}（聊了 ${t.depth} 轮，${sentimentLabel(t.sentiment)}）`,
    );
    sections.push(`【最近话题】\n${topicLines.join("\n")}`);
  }

  // Mood trajectory
  const recent = moodTrajectory.slice(-5);
  if (recent.length >= 2) {
    const moods = recent.map((m) => m.mood);
    sections.push(`【情绪轨迹】最近几轮：${moods.join(" → ")}`);
  }

  // Conversation summary
  if (conversationSummary) {
    sections.push(`【对话摘要】${conversationSummary}`);
  }

  // Proactive topics
  if (proactiveTopics.length > 0) {
    sections.push(
      `【可以主动聊的话题】${proactiveTopics.join("、")}（在合适时机自然提起）`,
    );
  }

  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

// ── Helpers ──

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function sentimentLabel(s: TopicEntry["sentiment"]): string {
  return s === "positive" ? "正面" : s === "negative" ? "负面" : "中性";
}
