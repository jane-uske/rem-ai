// ── Slow Brain State Store ──────────────────────────────────
// 每条 WebSocket 连接独立一份（C1）。

import type { PersistentRelationshipStateV1 } from "../memory/relationship_state";

export interface UserProfile {
  facts: Map<string, string>;
  interests: string[];
  personalityNotes: string[];
}

export interface RelationshipState {
  familiarity: number;
  emotionalBond: number;
  turnCount: number;
  preferredTopics: string[];
}

export interface TopicEntry {
  topic: string;
  depth: number;
  lastTurn: number;
  sentiment: "positive" | "neutral" | "negative";
}

export interface MoodSnapshot {
  turn: number;
  mood: string;
}

export interface SharedMoment {
  summary: string;
  topic: string;
  mood: string;
  hook: string;
  turn: number;
  createdAt: number;
}

export interface SlowBrainSnapshot {
  userProfile: UserProfile;
  relationship: RelationshipState;
  topicHistory: TopicEntry[];
  moodTrajectory: MoodSnapshot[];
  conversationSummary: string;
  proactiveTopics: string[];
  sharedMoments: SharedMoment[];
}

export class SlowBrainStore {
  private readonly profile: UserProfile = {
    facts: new Map(),
    interests: [],
    personalityNotes: [],
  };

  private readonly relationship: RelationshipState = {
    familiarity: 0,
    emotionalBond: 0,
    turnCount: 0,
    preferredTopics: [],
  };

  private readonly topicHistory: TopicEntry[] = [];
  private readonly moodTrajectory: MoodSnapshot[] = [];
  private conversationSummary = "";
  private proactiveTopics: string[] = [];
  private readonly sharedMoments: SharedMoment[] = [];

  addFact(key: string, value: string): void {
    this.profile.facts.set(key, value);
  }

  addInterest(interest: string): void {
    if (!this.profile.interests.includes(interest)) {
      this.profile.interests.push(interest);
    }
  }

  addPersonalityNote(note: string): void {
    if (this.profile.personalityNotes.length >= 5) {
      this.profile.personalityNotes.shift();
    }
    if (!this.profile.personalityNotes.includes(note)) {
      this.profile.personalityNotes.push(note);
    }
  }

  recordTurn(): void {
    this.relationship.turnCount++;
  }

  bumpRelationship(opts: {
    familiarityDelta?: number;
    emotionalBondDelta?: number;
  }): void {
    if (opts.familiarityDelta) {
      this.relationship.familiarity = clamp01(
        this.relationship.familiarity + opts.familiarityDelta,
      );
    }
    if (opts.emotionalBondDelta) {
      this.relationship.emotionalBond = clamp01(
        this.relationship.emotionalBond + opts.emotionalBondDelta,
      );
    }
  }

  touchTopic(
    topic: string,
    sentiment: TopicEntry["sentiment"] = "neutral",
  ): void {
    const existing = this.topicHistory.find((t) => t.topic === topic);
    if (existing) {
      existing.depth++;
      existing.lastTurn = this.relationship.turnCount;
      existing.sentiment = sentiment;
    } else {
      this.topicHistory.push({
        topic,
        depth: 1,
        lastTurn: this.relationship.turnCount,
        sentiment,
      });
    }

    if (
      !this.relationship.preferredTopics.includes(topic) &&
      (existing?.depth ?? 0) >= 2
    ) {
      this.relationship.preferredTopics.push(topic);
    }
  }

  recordMood(mood: string): void {
    this.moodTrajectory.push({ turn: this.relationship.turnCount, mood });
    if (this.moodTrajectory.length > 20) this.moodTrajectory.shift();
  }

  setConversationSummary(summary: string): void {
    this.conversationSummary = summary;
  }

  setProactiveTopics(topics: string[]): void {
    this.proactiveTopics = topics.slice(0, 5);
  }

  recordSharedMoment(input: {
    summary: string;
    topic?: string;
    mood?: string;
    hook?: string;
    createdAt?: number;
  }): void {
    const summary = input.summary.trim();
    if (!summary) return;

    const topic = input.topic?.trim() ?? "";
    const mood = input.mood?.trim() ?? "";
    const hook = input.hook?.trim() ?? "";
    const normalized = summary.toLowerCase();
    const existingIndex = this.sharedMoments.findIndex((entry) => {
      if (entry.summary.toLowerCase() === normalized) return true;
      if (topic && entry.topic === topic && entry.turn === this.relationship.turnCount) {
        return true;
      }
      return false;
    });

    const nextMoment: SharedMoment = {
      summary,
      topic,
      mood,
      hook,
      turn: this.relationship.turnCount,
      createdAt: input.createdAt ?? Date.now(),
    };

    if (existingIndex >= 0) {
      this.sharedMoments.splice(existingIndex, 1);
    }
    this.sharedMoments.unshift(nextMoment);
    if (this.sharedMoments.length > 6) {
      this.sharedMoments.length = 6;
    }
  }

  exportPersistentState(updatedAt: number = Date.now()): PersistentRelationshipStateV1 {
    const snap = this.getSnapshot();
    return {
      version: "v1",
      updatedAt,
      userProfile: {
        interests: [...snap.userProfile.interests],
        personalityNotes: [...snap.userProfile.personalityNotes],
      },
      relationship: {
        ...snap.relationship,
        preferredTopics: [...snap.relationship.preferredTopics],
      },
      topicHistory: snap.topicHistory.map((entry) => ({ ...entry })),
      moodTrajectory: snap.moodTrajectory.map((entry) => ({ ...entry })),
      conversationSummary: snap.conversationSummary,
      proactiveTopics: [...snap.proactiveTopics],
      sharedMoments: snap.sharedMoments.map((entry) => ({ ...entry })),
    };
  }

  hydratePersistentState(state: PersistentRelationshipStateV1): void {
    this.profile.interests.splice(
      0,
      this.profile.interests.length,
      ...state.userProfile.interests,
    );
    this.profile.personalityNotes.splice(
      0,
      this.profile.personalityNotes.length,
      ...state.userProfile.personalityNotes,
    );

    this.relationship.familiarity = clamp01(state.relationship.familiarity);
    this.relationship.emotionalBond = clamp01(state.relationship.emotionalBond);
    this.relationship.turnCount = Math.max(0, state.relationship.turnCount);
    this.relationship.preferredTopics.splice(
      0,
      this.relationship.preferredTopics.length,
      ...state.relationship.preferredTopics,
    );

    this.topicHistory.splice(
      0,
      this.topicHistory.length,
      ...state.topicHistory.map((entry) => ({ ...entry })),
    );
    this.moodTrajectory.splice(
      0,
      this.moodTrajectory.length,
      ...state.moodTrajectory.map((entry) => ({ ...entry })),
    );
    this.conversationSummary = state.conversationSummary;
    this.proactiveTopics.splice(
      0,
      this.proactiveTopics.length,
      ...state.proactiveTopics,
    );
    this.sharedMoments.splice(
      0,
      this.sharedMoments.length,
      ...state.sharedMoments.map((entry) => ({ ...entry })),
    );
  }

  getSnapshot(): SlowBrainSnapshot {
    return {
      userProfile: {
        facts: new Map(this.profile.facts),
        interests: [...this.profile.interests],
        personalityNotes: [...this.profile.personalityNotes],
      },
      relationship: { ...this.relationship },
      topicHistory: this.topicHistory.map((t) => ({ ...t })),
      moodTrajectory: [...this.moodTrajectory],
      conversationSummary: this.conversationSummary,
      proactiveTopics: [...this.proactiveTopics],
      sharedMoments: this.sharedMoments.map((entry) => ({ ...entry })),
    };
  }

  synthesizeContext(): string | undefined {
    const sections: string[] = [];
    const { profile, relationship } = this;

    if (profile.facts.size > 0 || profile.interests.length > 0) {
      const lines: string[] = [];
      for (const [k, v] of profile.facts) lines.push(`${k}：${v}`);
      if (profile.interests.length > 0)
        lines.push(`兴趣爱好：${profile.interests.join("、")}`);
      sections.push(`【用户画像】\n${lines.join("\n")}`);
    }

    if (profile.personalityNotes.length > 0) {
      sections.push(
        `【性格观察】\n${profile.personalityNotes.map((n) => `- ${n}`).join("\n")}`,
      );
    }

    if (relationship.turnCount > 0) {
      const level = relationship.familiarity > 0.6
        ? "已经很熟了"
        : relationship.familiarity > 0.3
          ? "逐渐熟悉中"
          : "刚认识不久";
      const bond = relationship.emotionalBond > 0.5
        ? "，用户比较信任你" : "";
      let stageHint = "";
      if (relationship.familiarity < 0.25) {
        stageHint =
          "说话可礼貌、略带好奇，多倾听，少自来熟；称呼自然即可。";
      } else if (relationship.familiarity < 0.55) {
        stageHint =
          "可以偶尔用更口语的表达，适度分享你的小感受，仍尊重对方节奏。";
      } else {
        stageHint =
          "可以更随意、更短句，像老朋友一样；可以开玩笑、撒娇一点，但对方低落时要收一点。";
      }
      sections.push(
        `【关系状态】${level}（聊了 ${relationship.turnCount} 轮）${bond}\n【陪伴阶段提示】${stageHint}`,
      );
    }

    const recentTopics = this.topicHistory
      .filter((t) => t.lastTurn >= relationship.turnCount - 3)
      .sort((a, b) => b.depth - a.depth);
    if (recentTopics.length > 0) {
      const topicLines = recentTopics.map(
        (t) => `- ${t.topic}（聊了 ${t.depth} 轮，${sentimentLabel(t.sentiment)}）`,
      );
      sections.push(`【最近话题】\n${topicLines.join("\n")}`);
    }

    const recent = this.moodTrajectory.slice(-5);
    if (recent.length >= 2) {
      const moods = recent.map((m) => m.mood);
      sections.push(`【情绪轨迹】最近几轮：${moods.join(" → ")}`);
    }

    if (this.conversationSummary) {
      sections.push(`【对话摘要】${this.conversationSummary}`);
    }

    if (this.proactiveTopics.length > 0) {
      sections.push(
        `【可以主动聊的话题】${this.proactiveTopics.join("、")}（在合适时机自然提起）`,
      );
    }

    if (this.sharedMoments.length > 0) {
      const recentMoments = this.sharedMoments
        .slice(0, 2)
        .map((entry) => `- ${entry.summary}`);
      sections.push(`【最近共同经历】\n${recentMoments.join("\n")}`);
    }

    return sections.length > 0 ? sections.join("\n\n") : undefined;
  }

  buildConversationStrategyHints(userMessage: string): string | undefined {
    const snap = this.getSnapshot();
    const lines: string[] = [];

    const { familiarity, emotionalBond, turnCount } = snap.relationship;
    if (turnCount > 0 && turnCount < 4) {
      lines.push("对话刚开始：语气友好、可多问一句，避免长篇说教。");
    } else if (familiarity > 0.55) {
      lines.push("已较熟悉：回复可更短、更口语，不必每句都客套。");
    } else if (familiarity > 0.25) {
      lines.push("关系在加深：可适度分享简短感受，再回应用户。");
    }

    if (emotionalBond > 0.45) {
      lines.push("用户较信任你：语气可更温柔、少评判。");
    }

    const relationshipStyle = buildRelationshipStyleGuidance(snap);
    if (relationshipStyle) {
      lines.push(relationshipStyle);
    }

    const lastMoods = snap.moodTrajectory.slice(-3).map((m) => m.mood).join("");
    if (/难过|伤心|焦虑|疲惫|烦|丧/.test(lastMoods)) {
      lines.push("近期情绪偏负面：先共情与确认感受，少给大道理。");
    }

    const trimmed = userMessage.trim();
    if (trimmed.length > 0 && trimmed.length < 12) {
      lines.push("本轮用户说得简短：可轻问一句「想多聊聊吗」或接话展开，别长篇。");
    }

    if (snap.proactiveTopics.length > 0 && familiarity > 0.35) {
      lines.push(
        `若用户话少或冷场，可从这些方向自然接话：${snap.proactiveTopics.slice(0, 2).join("、")}。`,
      );
    }

    const proactiveCandidate = pickProactiveHook(snap, userMessage);
    if (proactiveCandidate) {
      lines.push(`【主动提起候选】如果这轮适合自然续聊，可轻轻接回：${proactiveCandidate}`);
    }

    const sharedMomentCandidate = pickSharedMomentCue(snap, userMessage);
    if (sharedMomentCandidate) {
      lines.push(`【共同经历提醒】若用户提到相关线索，可自然承接：${sharedMomentCandidate}`);
    }

    return lines.length > 0 ? lines.join("\n") : undefined;
  }

  buildSilenceNudgeUserMessage(): string | null {
    const minTurns = Number(process.env.REM_SILENCE_NUDGE_MIN_TURNS ?? 2);
    const snap = this.getSnapshot();
    if (snap.relationship.turnCount < minTurns) return null;

    const topics = snap.proactiveTopics.slice(0, 3);
    const topicHint =
      topics.length > 0
        ? `可以参考的轻松方向：${topics.join("、")}。`
        : "不必硬找话题，一句问候或分享小事也可以。";

    return (
      `（系统情境：对方有一段时间没发消息了。请你作为 Rem，用一两句自然、温柔的中文主动开口，像在陪在身边一样；${topicHint}不要一次问太多问题，不要显得像在催对方回复。）`
    );
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function sentimentLabel(s: TopicEntry["sentiment"]): string {
  return s === "positive" ? "正面" : s === "negative" ? "负面" : "中性";
}

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

function relationshipStyleGuidanceEnabled(): boolean {
  return parseBooleanFlag(process.env.REM_RELATIONSHIP_STYLE_GUIDANCE_ENABLED, true);
}

function proactivePromptEnabled(): boolean {
  return parseBooleanFlag(process.env.REM_PROACTIVE_PROMPT_ENABLED, true);
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
  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function buildRelationshipStyleGuidance(snap: SlowBrainSnapshot): string | null {
  if (!relationshipStyleGuidanceEnabled()) return null;

  const { familiarity, emotionalBond } = snap.relationship;
  const addressStyle =
    familiarity > 0.6
      ? "称呼可以更亲近、更口语"
      : familiarity > 0.3
        ? "称呼自然一点，不用太客套"
        : "称呼保持自然礼貌，先别太自来熟";
  const careStyle =
    emotionalBond > 0.55
      ? "关心可以更直接、更有陪伴感"
      : emotionalBond > 0.3
        ? "关心保持稳定温柔，轻轻接住情绪"
        : "关心点到为止，先陪对方说完";
  const followUpStyle =
    familiarity > 0.5
      ? "追问可以略深一层，但别连问太多"
      : "追问只补一小步，留空间给对方";
  const emotionCarryStyle =
    emotionalBond > 0.45
      ? "情绪承接时先共情，再顺着对方节奏继续"
      : "情绪承接先确认感受，不急着给方案";

  return `【关系表达风格】${addressStyle}；${careStyle}；${followUpStyle}；${emotionCarryStyle}。`;
}

function pickProactiveHook(snap: SlowBrainSnapshot, userMessage: string): string | null {
  if (!proactivePromptEnabled()) return null;
  if (snap.relationship.turnCount < 2 || snap.relationship.familiarity < 0.3) return null;

  const message = userMessage.trim();
  const messageKeywords = new Set(extractKeywords(message));
  const candidates = [
    ...snap.proactiveTopics,
    ...snap.sharedMoments.map((entry) => entry.hook).filter(Boolean),
  ].filter(Boolean);
  if (candidates.length === 0) return null;

  const uniqueCandidates = [...new Set(candidates)];
  const ranked = uniqueCandidates
    .map((candidate) => ({
      candidate,
      score: extractKeywords(candidate).reduce(
        (sum, keyword) => sum + (messageKeywords.has(keyword) ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.candidate.length - b.candidate.length);

  if (ranked[0]?.score > 0) {
    return ranked[0].candidate;
  }

  return message.length <= 12 ? ranked[0]?.candidate ?? null : null;
}

function pickSharedMomentCue(snap: SlowBrainSnapshot, userMessage: string): string | null {
  if (snap.sharedMoments.length === 0) return null;

  const messageKeywords = new Set(extractKeywords(userMessage));
  const moments = snap.sharedMoments
    .map((entry) => {
      const text = `${entry.summary} ${entry.topic} ${entry.hook}`.trim();
      const score = extractKeywords(text).reduce(
        (sum, keyword) => sum + (messageKeywords.has(keyword) ? 1 : 0),
        0,
      );
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score || b.entry.turn - a.entry.turn);

  if (moments[0]?.score && moments[0].score > 0) {
    return moments[0].entry.summary;
  }

  return userMessage.trim().length <= 10 ? moments[0]?.entry.summary ?? null : null;
}
