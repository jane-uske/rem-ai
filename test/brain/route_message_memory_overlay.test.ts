const assert = require("assert").strict;
const path = require("path");

const { RemSessionContext } = require("../../brains/rem_session_context");

function createPersistentRepo(entries = []) {
  const hooks = { getAllCalls: 0 };
  return {
    hooks,
    repo: {
      async upsert() {},
      async getAll() {
        hooks.getAllCalls += 1;
        return entries.map((entry) => ({ ...entry }));
      },
      async getByKey(key) {
        const found = entries.find((entry) => entry.key === key);
        return found ? { ...found } : null;
      },
      async delete() {},
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

describe("routeMessage with session memory overlay", () => {
  it("uses hydrated local memory without re-reading persistent storage on each prompt build", async () => {
    const ctx = new RemSessionContext("memory-overlay-route");
    const { hooks, repo } = createPersistentRepo([
      {
        key: "名字",
        value: "小满",
        importance: 0.5,
        accessCount: 0,
        createdAt: 100,
        lastAccessedAt: 300,
      },
    ]);
    ctx.memory.attachPersistent(repo);
    await ctx.memory.hydrateFromPersistent(12);

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        memory: input.memory.map((entry) => ({ ...entry })),
      });
      yield "记住啦";
    });

    try {
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "我们继续聊", "neutral")) {
        chunks.push(chunk);
      }

      assert.equal(hooks.getAllCalls, 1);
      assert.deepEqual(chunks, ["记住啦"]);
      assert.equal(captured.length, 1);
      assert.deepEqual(captured[0].memory, [{ key: "名字", value: "小满" }]);
    } finally {
      restore();
    }
  });
});
