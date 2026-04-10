const assert = require("assert").strict;

const { InMemoryRepository } = require("../../memory/memory_store");
const { retrievePromptMemory } = require("../../memory/memory_agent");

function applyEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function seedRepo(entries) {
  const repo = new InMemoryRepository();
  const now = Date.now();
  for (const entry of entries) {
    await repo.upsert(entry.key, entry.value, entry.importance);
    const stored = repo.entries.find((item) => item.key === entry.key);
    stored.createdAt = entry.createdAt ?? now;
    stored.lastAccessedAt = entry.lastAccessedAt ?? now;
    stored.importance = entry.importance ?? stored.importance;
  }
  return repo;
}

describe("prompt memory retrieval", () => {
  it("prioritizes relationship-relevant facts after stable core facts", async () => {
    const repo = await seedRepo([
      { key: "名字", value: "小满", importance: 0.9, lastAccessedAt: 100 },
      { key: "城市", value: "杭州", importance: 0.7, lastAccessedAt: 200 },
      { key: "工作", value: "设计师", importance: 0.4, lastAccessedAt: 50 },
      { key: "运动喜好", value: "夜跑", importance: 0.6, lastAccessedAt: 500 },
      { key: "睡眠困扰", value: "失眠", importance: 0.8, lastAccessedAt: 450 },
      { key: "收藏歌手", value: "王菲", importance: 0.95, lastAccessedAt: 900 },
    ]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "昨晚夜跑完还是有点失眠",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.4,
          emotionalBond: 0.3,
          turnCount: 5,
          preferredTopics: ["夜跑", "睡眠"],
        },
        topicHistory: [
          { topic: "夜跑", depth: 2, lastTurn: 5, sentiment: "positive" },
          { topic: "睡眠", depth: 3, lastTurn: 5, sentiment: "negative" },
        ],
        moodTrajectory: [{ turn: 5, mood: "疲惫/烦躁" }],
        conversationSummary: "最近一直在聊夜跑和睡眠状态。",
        proactiveTopics: ["昨晚睡得怎么样"],
        sharedMoments: [
          {
            summary: "上次你提到夜跑完还是睡不着，我们一起聊了怎么让身体慢慢放松。",
            topic: "睡眠",
            mood: "疲惫/烦躁",
            hook: "昨晚睡得怎么样",
            turn: 5,
            createdAt: 500,
          },
        ],
      },
      maxEntries: 4,
    });

    assert.equal(memories.length, 4);
    assert.deepEqual(memories.slice(0, 2).map((entry) => entry.key), ["名字", "城市"]);
    assert.equal(memories.some((entry) => entry.key === "最近共同经历"), true);
    assert.equal(memories.some((entry) => entry.key === "运动喜好"), true);
    assert.equal(memories.some((entry) => entry.key === "收藏歌手"), false);
  });

  it("falls back to core facts and recent important entries when relationship context is absent", async () => {
    const repo = await seedRepo([
      { key: "名字", value: "阿宁", importance: 0.9, lastAccessedAt: 100 },
      { key: "城市", value: "上海", importance: 0.7, lastAccessedAt: 150 },
      { key: "宠物", value: "猫", importance: 0.3, lastAccessedAt: 120 },
      { key: "收藏歌手", value: "王菲", importance: 0.95, lastAccessedAt: 900 },
    ]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "嗯",
      maxEntries: 3,
    });

    assert.deepEqual(memories.map((entry) => entry.key), ["名字", "城市", "收藏歌手"]);
  });

  it("can surface a shared moment even when there are no fact memories yet", async () => {
    const repo = await seedRepo([]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "继续刚才那个睡不着的话题",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.55,
          emotionalBond: 0.42,
          turnCount: 6,
          preferredTopics: ["睡眠"],
        },
        topicHistory: [
          { topic: "睡眠", depth: 3, lastTurn: 6, sentiment: "negative" },
        ],
        moodTrajectory: [{ turn: 6, mood: "疲惫/烦躁" }],
        conversationSummary: "最近一直在聊失眠和晚上的状态。",
        proactiveTopics: ["昨晚睡得怎么样"],
        sharedMoments: [
          {
            summary: "上次你提到失眠反复醒来，我们还聊到睡前散步会不会好一点。",
            topic: "睡眠",
            mood: "疲惫/烦躁",
            hook: "昨晚睡得怎么样",
            turn: 6,
            createdAt: 700,
          },
        ],
      },
      maxEntries: 2,
    });

    assert.deepEqual(memories, [
      {
        key: "最近共同经历",
        value: "上次你提到失眠反复醒来，我们还聊到睡前散步会不会好一点。",
      },
    ]);
  });

  it("never returns reserved relationship state keys", async () => {
    const restoreEnv = applyEnv({ MAX_PROMPT_MEMORY_ENTRIES: "6" });
    const repo = await seedRepo([
      { key: "名字", value: "阿宁", importance: 0.9, lastAccessedAt: 100 },
      {
        key: "__rem_relationship_state_v1",
        value: '{"version":"v1"}',
        importance: 1,
        lastAccessedAt: 999,
      },
    ]);

    try {
      const memories = await retrievePromptMemory(repo, {
        userMessage: "我们继续聊",
      });
      assert.deepEqual(memories, [{ key: "名字", value: "阿宁" }]);
    } finally {
      restoreEnv();
    }
  });
});
