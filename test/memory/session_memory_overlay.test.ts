const assert = require("assert").strict;

const {
  SessionMemoryOverlayRepository,
} = require("../../memory/session_memory_overlay");

function createPersistentRepo(entries = [], hooks = {}) {
  let current = entries.map((entry) => ({ ...entry }));
  return {
    hooks,
    async upsert(key, value, importance = 0.5) {
      hooks.upsertCalls = (hooks.upsertCalls ?? 0) + 1;
      hooks.upsertArgs = [...(hooks.upsertArgs ?? []), { key, value, importance }];
      if (hooks.failUpsert) {
        throw new Error("persistent upsert failed");
      }
      const now = Date.now();
      const existing = current.find((entry) => entry.key === key);
      if (existing) {
        existing.value = value;
        existing.importance = importance;
        existing.lastAccessedAt = now;
      } else {
        current.push({
          key,
          value,
          importance,
          accessCount: 0,
          createdAt: now,
          lastAccessedAt: now,
        });
      }
    },
    async getAll() {
      hooks.getAllCalls = (hooks.getAllCalls ?? 0) + 1;
      return current.map((entry) => ({ ...entry }));
    },
    async getByKey(key) {
      const found = current.find((entry) => entry.key === key);
      return found ? { ...found } : null;
    },
    async delete(key) {
      current = current.filter((entry) => entry.key !== key);
    },
    async touch(key) {
      const found = current.find((entry) => entry.key === key);
      if (found) {
        found.lastAccessedAt = Date.now();
      }
    },
    async getStale(maxAge, minImportance) {
      const now = Date.now();
      return current
        .filter(
          (entry) =>
            now - entry.lastAccessedAt > maxAge && entry.importance < minImportance,
        )
        .map((entry) => ({ ...entry }));
    },
  };
}

describe("session memory overlay", () => {
  it("hydrates only the most recent persistent entries into the local overlay", async () => {
    const overlay = new SessionMemoryOverlayRepository();
    const persistent = createPersistentRepo([
      {
        key: "城市",
        value: "上海",
        importance: 0.5,
        accessCount: 0,
        createdAt: 100,
        lastAccessedAt: 800,
      },
      {
        key: "名字",
        value: "小林",
        importance: 0.5,
        accessCount: 0,
        createdAt: 300,
        lastAccessedAt: 900,
      },
      {
        key: "宠物",
        value: "猫",
        importance: 0.5,
        accessCount: 0,
        createdAt: 200,
        lastAccessedAt: 900,
      },
    ]);

    overlay.attachPersistent(persistent);
    await overlay.hydrateFromPersistent(2);

    const hydrated = await overlay.getAll();
    assert.deepEqual(
      hydrated.map((entry) => [entry.key, entry.value]),
      [
        ["名字", "小林"],
        ["宠物", "猫"],
      ],
    );
  });

  it("keeps writes local-first and mirrors them to persistent storage asynchronously", async () => {
    const hooks = {};
    const overlay = new SessionMemoryOverlayRepository();
    overlay.attachPersistent(createPersistentRepo([], hooks));

    await overlay.upsert("喜好", "爵士乐", 0.7);

    const local = await overlay.getAll();
    assert.deepEqual(local.map((entry) => [entry.key, entry.value]), [["喜好", "爵士乐"]]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(hooks.upsertCalls, 1);
    assert.deepEqual(hooks.upsertArgs[0], {
      key: "喜好",
      value: "爵士乐",
      importance: 0.7,
    });
  });

  it("preserves local state even if persistent mirroring fails", async () => {
    const overlay = new SessionMemoryOverlayRepository();
    overlay.attachPersistent(createPersistentRepo([], { failUpsert: true }));

    await overlay.upsert("工作", "设计师", 0.6);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const local = await overlay.getAll();
    assert.deepEqual(local.map((entry) => [entry.key, entry.value]), [["工作", "设计师"]]);
  });

  it("does not hydrate reserved relationship state keys into prompt memory overlay", async () => {
    const overlay = new SessionMemoryOverlayRepository();
    overlay.attachPersistent(createPersistentRepo([
      {
        key: "__rem_relationship_state_v1",
        value: '{"version":"v1"}',
        importance: 1,
        accessCount: 0,
        createdAt: 100,
        lastAccessedAt: 900,
      },
      {
        key: "名字",
        value: "小林",
        importance: 0.5,
        accessCount: 0,
        createdAt: 300,
        lastAccessedAt: 800,
      },
    ]));

    await overlay.hydrateFromPersistent(12);

    const hydrated = await overlay.getAll();
    assert.deepEqual(hydrated.map((entry) => [entry.key, entry.value]), [["名字", "小林"]]);
  });

  it("clears only reserved system keys from persistent storage when includePersistent is enabled", async () => {
    const overlay = new SessionMemoryOverlayRepository();
    const persistent = createPersistentRepo([
      {
        key: "__rem_relationship_state_v1",
        value: '{"version":"v1"}',
        importance: 1,
        accessCount: 0,
        createdAt: 100,
        lastAccessedAt: 900,
      },
      {
        key: "名字",
        value: "小林",
        importance: 0.5,
        accessCount: 0,
        createdAt: 300,
        lastAccessedAt: 800,
      },
    ]);
    overlay.attachPersistent(persistent);

    await overlay.upsert("临时", "会话内");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await overlay.clearAll(true);

    const local = await overlay.getAll();
    assert.equal(local.length, 0);

    const persistentEntries = await persistent.getAll();
    assert.equal(
      persistentEntries.some((entry) => entry.key === "__rem_relationship_state_v1"),
      false,
    );
    assert.equal(
      persistentEntries.some((entry) => entry.key === "名字"),
      true,
    );
    assert.equal(
      persistentEntries.some((entry) => entry.key === "临时"),
      true,
    );
  });
});
