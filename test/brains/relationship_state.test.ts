const assert = require("assert").strict;
const path = require("path");

const { RemSessionContext } = require("../../brains/rem_session_context");
const { SlowBrainStore } = require("../../brains/slow_brain_store");
const { fastBrainPredictOnly } = require("../../brains/fast_brain");
const { retrieveMemory } = require("../../memory/memory_agent");
const {
  RELATIONSHIP_STATE_KEY,
  loadPersistentRelationshipState,
  savePersistentRelationshipState,
} = require("../../memory/relationship_state");
const { InMemoryRepository } = require("../../memory/memory_store");

function createPersistentRepo() {
  const hooks = { upsertArgs: [] };
  const store = new Map();
  return {
    hooks,
    repo: {
      async upsert(key, value, importance = 0.5) {
        hooks.upsertArgs.push({ key, value, importance });
        store.set(key, {
          key,
          value,
          importance,
          accessCount: 0,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
        });
      },
      async getAll() {
        return [...store.values()].map((entry) => ({ ...entry }));
      },
      async getByKey(key) {
        const found = store.get(key);
        return found ? { ...found } : null;
      },
      async delete(key) {
        store.delete(key);
      },
      async touch() {},
      async getStale() {
        return [];
      },
    },
  };
}

function loadMockedRouteMessage(fastBrainStream) {
  const fastBrainModulePath = path.resolve(__dirname, "../../brains/fast_brain.ts");
  const brainRouterModulePath = path.resolve(__dirname, "../../brains/brain_router.ts");
  const fastBrainModule = require(fastBrainModulePath);
  const originalFastBrainStream = fastBrainModule.fastBrainStream;

  fastBrainModule.fastBrainStream = fastBrainStream;
  delete require.cache[brainRouterModulePath];
  const { routeMessage } = require(brainRouterModulePath);

  return {
    routeMessage,
    restore() {
      fastBrainModule.fastBrainStream = originalFastBrainStream;
      delete require.cache[brainRouterModulePath];
    },
  };
}

describe("relationship state persistence", () => {
  it("round-trips structured relationship state through the memory repository", async () => {
    const { repo } = createPersistentRepo();
    const store = new SlowBrainStore();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.2, emotionalBondDelta: 0.1 });
    store.addInterest("散步");
    store.addPersonalityNote("更愿意晚上慢慢聊");
    store.touchTopic("睡眠", "negative");
    store.recordMood("难过");
    store.setConversationSummary("最近在聊失眠和晚上散步。");
    store.setProactiveTopics(["昨晚睡得怎么样"]);
    store.recordSharedMoment({
      summary: "上次你提到最近睡不太好，我们顺着这个聊了很久。",
      topic: "睡眠",
      mood: "难过",
      hook: "昨晚睡得怎么样",
      createdAt: 120,
    });

    await savePersistentRelationshipState(repo, store.exportPersistentState(123));
    const loaded = await loadPersistentRelationshipState(repo);

    assert.equal(loaded.version, "v1");
    assert.equal(loaded.updatedAt, 123);
    assert.equal(loaded.relationship.turnCount, 1);
    assert.deepEqual(loaded.userProfile.interests, ["散步"]);
    assert.equal(loaded.conversationSummary, "最近在聊失眠和晚上散步。");
    assert.equal(loaded.sharedMoments.length, 1);
    assert.equal(loaded.sharedMoments[0].topic, "睡眠");
  });

  it("filters system relationship entries out of prompt memory retrieval", async () => {
    const repo = new InMemoryRepository();
    await repo.upsert("名字", "阿宁");
    await repo.upsert(RELATIONSHIP_STATE_KEY, '{"version":"v1"}');

    const memories = await retrieveMemory(repo);
    assert.deepEqual(memories, [{ key: "名字", value: "阿宁" }]);
  });

  it("restores relationship continuity without polluting fact memory overlay", async () => {
    const ctx = new RemSessionContext("relationship-restore");
    const { repo } = createPersistentRepo();
    await repo.upsert("名字", "阿宁", 0.5);
    await repo.upsert(
      RELATIONSHIP_STATE_KEY,
      JSON.stringify({
        version: "v1",
        updatedAt: 123,
        userProfile: {
          interests: ["散步", "夜跑"],
          personalityNotes: ["更愿意晚上聊心事"],
        },
        relationship: {
          familiarity: 0.42,
          emotionalBond: 0.37,
          turnCount: 5,
          preferredTopics: ["睡眠", "散步"],
        },
        topicHistory: [
          { topic: "睡眠", depth: 2, lastTurn: 5, sentiment: "negative" },
          { topic: "散步", depth: 3, lastTurn: 4, sentiment: "positive" },
        ],
        moodTrajectory: [
          { turn: 3, mood: "疲惫/烦躁" },
          { turn: 4, mood: "平静" },
          { turn: 5, mood: "难过" },
        ],
        conversationSummary: "最近一直在聊她晚上睡不好，还有散步能不能让人放松一点。",
        proactiveTopics: ["昨晚睡得怎么样", "今天有没有出去走走"],
        sharedMoments: [
          {
            summary: "上次你提到晚上睡不好，我们还聊到散步会不会有帮助。",
            topic: "睡眠",
            mood: "难过",
            hook: "昨晚睡得怎么样",
            turn: 5,
            createdAt: 200,
          },
        ],
      }),
      1,
    );
    ctx.memory.attachPersistent(repo);
    ctx.attachPersistentRelationshipRepo(repo);

    await ctx.memory.hydrateFromPersistent(12);
    const relationshipState = await loadPersistentRelationshipState(repo);
    ctx.hydratePersistentRelationshipState(relationshipState);

    const memories = await ctx.memory.getAll();
    const snapshot = ctx.slowBrain.getSnapshot();
    assert.deepEqual(memories.map((entry) => [entry.key, entry.value]), [["名字", "阿宁"]]);
    assert.equal(snapshot.conversationSummary, "最近一直在聊她晚上睡不好，还有散步能不能让人放松一点。");
    assert.deepEqual(snapshot.proactiveTopics, ["昨晚睡得怎么样", "今天有没有出去走走"]);
    assert.equal(snapshot.sharedMoments.length, 1);
    assert.equal(snapshot.sharedMoments[0].topic, "睡眠");
    assert.deepEqual(snapshot.moodTrajectory.slice(-3), [
      { turn: 3, mood: "疲惫/烦躁" },
      { turn: 4, mood: "平静" },
      { turn: 5, mood: "难过" },
    ]);
    assert.equal(snapshot.relationship.turnCount, 5);
    assert.equal(
      ctx.persona.liveState.lastTopicSummary,
      "最近一直在聊她晚上睡不好，还有散步能不能让人放松一点。",
    );
  });

  it("keeps prediction-only generation read-only for relationship persistence", async () => {
    const { hooks } = createPersistentRepo();

    const reply = await fastBrainPredictOnly({
      userMessage: "我们继续刚才那个",
      emotion: "neutral",
      memory: [],
      history: [],
    });

    assert.equal(hooks.upsertArgs.length, 0);
    assert.ok(reply.includes("我听到了") || reply === "");
  });

  it("counts one completed turn even when relationship deltas update multiple times", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.02 });
    store.bumpRelationship({ emotionalBondDelta: 0.05 });
    store.bumpRelationship({ emotionalBondDelta: 0.03 });

    const snapshot = store.getSnapshot();
    assert.equal(snapshot.relationship.turnCount, 1);
    assert.equal(snapshot.relationship.familiarity, 0.02);
    assert.equal(snapshot.relationship.emotionalBond, 0.08);
  });

  it("does not persist relationship state for interrupted assistant turns", async () => {
    let releasePending = () => {};
    const pending = new Promise((resolve) => {
      releasePending = resolve;
    });
    const controller = new AbortController();
    const ctx = new RemSessionContext("relationship-interrupt");
    const { hooks, repo } = createPersistentRepo();
    ctx.attachPersistentRelationshipRepo(repo);

    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      yield "先说一半";
      await pending;
      if (input.signal?.aborted) {
        return;
      }
      yield "这句不该写入关系态";
    });

    try {
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "我们继续聊", "neutral", controller.signal)) {
        chunks.push(chunk);
        controller.abort();
        releasePending();
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(chunks, ["先说一半"]);
      assert.equal(
        hooks.upsertArgs.some((entry) => entry.key === RELATIONSHIP_STATE_KEY),
        false,
      );
    } finally {
      restore();
    }
  });
});
