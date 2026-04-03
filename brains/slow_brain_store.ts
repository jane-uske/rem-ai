// ── Slow Brain State Store ──────────────────────────────────
// 每条 WebSocket 连接独立一份（C1）。

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

export interface SlowBrainSnapshot {
  userProfile: UserProfile;
  relationship: RelationshipState;
  topicHistory: TopicEntry[];
  moodTrajectory: MoodSnapshot[];
  conversationSummary: string;
  proactiveTopics: string[];
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

  bumpRelationship(opts: {
    familiarityDelta?: number;
    emotionalBondDelta?: number;
  }): void {
    this.relationship.turnCount++;
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
