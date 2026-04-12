const assert = require("assert").strict;

function clearModule(modulePath) {
  delete require.cache[modulePath];
}

function stubModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

function loadEpisodeStore(overrides = {}) {
  const episodeStorePath = require.resolve("../../memory/episode_store");
  const embeddingClientPath = require.resolve("../../llm/embedding_client");
  const episodeRepositoryPath = require.resolve("../../storage/repositories/episode_repository");
  const originalEmbeddingClient = require.cache[embeddingClientPath];
  const originalEpisodeRepository = require.cache[episodeRepositoryPath];

  clearModule(episodeStorePath);

  stubModule(embeddingClientPath, overrides.embeddingClient ?? { embed: async () => [] });
  stubModule(episodeRepositoryPath, overrides.episodeRepository ?? {
    insertEpisode: async () => null,
    updateEpisode: async () => null,
    findSimilarEpisodes: async () => [],
    getUnresolvedEpisodes: async () => [],
  });

  const episodeStore = require("../../memory/episode_store");

  return {
    episodeStore,
    restore() {
      clearModule(episodeStorePath);
      if (originalEmbeddingClient) {
        require.cache[embeddingClientPath] = originalEmbeddingClient;
      } else {
        clearModule(embeddingClientPath);
      }
      if (originalEpisodeRepository) {
        require.cache[episodeRepositoryPath] = originalEpisodeRepository;
      } else {
        clearModule(episodeRepositoryPath);
      }
    },
  };
}

function makeVector(seedValues) {
  const vector = new Array(768).fill(0);
  seedValues.forEach((value, index) => {
    vector[index] = value;
  });
  return vector;
}

function makeEpisode(overrides = {}) {
  return {
    id: "episode-1",
    user_id: "user-1",
    title: "睡眠",
    summary: "睡眠：最近又失眠了",
    topics: ["睡眠"],
    mood: "tired",
    kind: "unresolved",
    salience: 0.6,
    recurrence_count: 2,
    unresolved: true,
    first_seen_at: new Date("2026-04-01T00:00:00.000Z"),
    last_seen_at: new Date("2026-04-10T00:00:00.000Z"),
    last_referenced_at: null,
    centroid_embedding: makeVector([1, 0, 0]),
    origin_moment_summaries: ["第一条", "第二条"],
    relationship_weight: 0.4,
    status: "active",
    ...overrides,
  };
}

describe("episode_store", () => {
  afterEach(() => {
    const episodeStorePath = require.resolve("../../memory/episode_store");
    clearModule(episodeStorePath);
  });

  it("ingest creates a new episode when no similar episode exists", async () => {
    const calls = {
      embed: [],
      insert: [],
    };
    const insertResult = makeEpisode({
      recurrence_count: 1,
      centroid_embedding: makeVector([0.4, 0.5, 0.6]),
      origin_moment_summaries: ["昨晚又失眠了"],
      salience: 0.7,
      relationship_weight: 0.7,
    });
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async (text) => {
          calls.embed.push(text);
          return makeVector([0.4, 0.5, 0.6]);
        },
      },
      episodeRepository: {
        insertEpisode: async (params) => {
          calls.insert.push(params);
          return insertResult;
        },
        updateEpisode: async () => null,
        findSimilarEpisodes: async () => [],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const episode = await episodeStore.ingest({
        userId: "user-1",
        summary: "昨晚又失眠了",
        topic: "睡眠",
        mood: "tired",
        kind: "unresolved",
        salience: 0.7,
        unresolved: true,
      });

      assert.equal(calls.embed[0], "昨晚又失眠了 睡眠 tired");
      assert.equal(calls.insert.length, 1);
      assert.deepEqual(calls.insert[0], {
        userId: "user-1",
        title: "睡眠",
        summary: "睡眠：昨晚又失眠了",
        topics: ["睡眠"],
        mood: "tired",
        kind: "unresolved",
        salience: 0.7,
        unresolved: true,
        centroidEmbedding: makeVector([0.4, 0.5, 0.6]),
        originMomentSummaries: ["昨晚又失眠了"],
        relationshipWeight: 0.7,
      });
      assert.equal(episode, insertResult);
    } finally {
      restore();
    }
  });

  it("ingest merges into an existing episode when similarity is above threshold", async () => {
    const calls = {
      update: [],
    };
    const existing = makeEpisode({
      recurrence_count: 2,
      centroid_embedding: makeVector([10, 0]),
      origin_moment_summaries: ["第一条", "第二条"],
      salience: 0.6,
      relationship_weight: 0.4,
    });
    const updatedResult = makeEpisode({
      recurrence_count: 3,
      centroid_embedding: makeVector([10, 1 / 3]),
      origin_moment_summaries: ["第一条", "第二条", "第三条"],
      salience: 0.9,
      relationship_weight: 0.9,
      summary: "睡眠：第三条",
      mood: "worried",
    });
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([10, 1]),
      },
      episodeRepository: {
        insertEpisode: async () => {
          throw new Error("insertEpisode should not be called");
        },
        updateEpisode: async (id, params) => {
          calls.update.push({ id, params });
          return updatedResult;
        },
        findSimilarEpisodes: async () => [existing],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const episode = await episodeStore.ingest({
        userId: "user-1",
        summary: "第三条",
        topic: "睡眠",
        mood: "worried",
        kind: "unresolved",
        salience: 0.9,
        unresolved: false,
      });

      assert.equal(calls.update.length, 1);
      assert.equal(calls.update[0].id, "episode-1");
      assert.equal(calls.update[0].params.recurrenceCount, 3);
      assert.equal(calls.update[0].params.salience, 0.9);
      assert.deepEqual(calls.update[0].params.originMomentSummaries, ["第一条", "第二条", "第三条"]);
      assert.deepEqual(calls.update[0].params.centroidEmbedding.slice(0, 2), [10, 1 / 3]);
      assert.equal(calls.update[0].params.relationshipWeight, 0.9);
      assert.equal(episode, updatedResult);
    } finally {
      restore();
    }
  });

  it("ingest creates a new episode when similarity is below threshold", async () => {
    const calls = {
      insert: 0,
      update: 0,
    };
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([0, 1]),
      },
      episodeRepository: {
        insertEpisode: async () => {
          calls.insert += 1;
          return makeEpisode({ id: "episode-new", recurrence_count: 1 });
        },
        updateEpisode: async () => {
          calls.update += 1;
          return null;
        },
        findSimilarEpisodes: async () => [makeEpisode({ centroid_embedding: makeVector([1, 0]) })],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      await episodeStore.ingest({
        userId: "user-1",
        summary: "换了一个完全不同的话题",
        topic: "工作",
        mood: "neutral",
        kind: "milestone",
        salience: 0.5,
        unresolved: false,
      });

      assert.equal(calls.insert, 1);
      assert.equal(calls.update, 0);
    } finally {
      restore();
    }
  });

  it("findRelevant ranks episodes by blended score", async () => {
    const realDateNow = Date.now;
    Date.now = () => new Date("2026-04-12T00:00:00.000Z").getTime();
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([1, 0]),
      },
      episodeRepository: {
        insertEpisode: async () => null,
        updateEpisode: async () => null,
        findSimilarEpisodes: async () => [
          makeEpisode({
            id: "high-cosine",
            centroid_embedding: makeVector([1, 0]),
            salience: 0.4,
            unresolved: false,
            last_seen_at: new Date("2026-04-02T00:00:00.000Z"),
          }),
          makeEpisode({
            id: "unresolved-recent",
            centroid_embedding: makeVector([0.8, 0.2]),
            salience: 0.7,
            unresolved: true,
            last_seen_at: new Date("2026-04-11T00:00:00.000Z"),
          }),
          makeEpisode({
            id: "stale-low",
            centroid_embedding: makeVector([0.5, 0.5]),
            salience: 0.2,
            unresolved: false,
            last_seen_at: new Date("2026-03-01T00:00:00.000Z"),
          }),
        ],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const ranked = await episodeStore.findRelevant("user-1", "最近睡得怎么样");

      assert.deepEqual(
        ranked.map((entry) => entry.episode.id),
        ["unresolved-recent", "high-cosine", "stale-low"],
      );
      assert.equal(ranked[0].score > ranked[1].score, true);
      assert.equal(ranked[1].score > ranked[2].score, true);
    } finally {
      Date.now = realDateNow;
      restore();
    }
  });

  it("findRelevant returns an empty array when repository returns no episodes", async () => {
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([1, 0]),
      },
      episodeRepository: {
        insertEpisode: async () => null,
        updateEpisode: async () => null,
        findSimilarEpisodes: async () => [],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const ranked = await episodeStore.findRelevant("user-1", "hello");
      assert.deepEqual(ranked, []);
    } finally {
      restore();
    }
  });

  it("cosineSimilarity computes expected values", () => {
    const { episodeStore, restore } = loadEpisodeStore();

    try {
      assert.equal(episodeStore.cosineSimilarity([1, 0], [1, 0]), 1);
      assert.equal(episodeStore.cosineSimilarity([1, 0], [0, 1]), 0);
      assert.equal(
        Math.round(episodeStore.cosineSimilarity([1, 1], [1, 0]) * 1000) / 1000,
        0.707,
      );
      assert.equal(episodeStore.cosineSimilarity([], [1, 0]), 0);
    } finally {
      restore();
    }
  });

  it("markReferenced delegates to updateEpisode", async () => {
    const calls = [];
    const { episodeStore, restore } = loadEpisodeStore({
      episodeRepository: {
        insertEpisode: async () => null,
        updateEpisode: async (id, params) => {
          calls.push({ id, params });
          return makeEpisode();
        },
        findSimilarEpisodes: async () => [],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      await episodeStore.markReferenced("episode-1");

      assert.equal(calls.length, 1);
      assert.equal(calls[0].id, "episode-1");
      assert.ok(calls[0].params.lastReferencedAt instanceof Date);
    } finally {
      restore();
    }
  });
});
