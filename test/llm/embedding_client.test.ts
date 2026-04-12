const assert = require("assert").strict;

function clearEmbeddingClientModule() {
  const modulePath = require.resolve("../../llm/embedding_client");
  delete require.cache[modulePath];
}

function mockOpenAI(OpenAIClass: unknown) {
  const openaiPath = require.resolve("openai");
  const existing = require.cache[openaiPath];
  require.cache[openaiPath] = {
    id: openaiPath,
    filename: openaiPath,
    loaded: true,
    exports: {
      __esModule: true,
      default: OpenAIClass,
    },
  };
  return () => {
    if (existing) {
      require.cache[openaiPath] = existing;
    } else {
      delete require.cache[openaiPath];
    }
  };
}

describe("embedding_client", () => {
  const originalEnv = {
    REM_EMBEDDING_BASE_URL: process.env.REM_EMBEDDING_BASE_URL,
    REM_EMBEDDING_API_KEY: process.env.REM_EMBEDDING_API_KEY,
    REM_EMBEDDING_MODEL: process.env.REM_EMBEDDING_MODEL,
  };

  afterEach(() => {
    clearEmbeddingClientModule();
    if (originalEnv.REM_EMBEDDING_BASE_URL === undefined) {
      delete process.env.REM_EMBEDDING_BASE_URL;
    } else {
      process.env.REM_EMBEDDING_BASE_URL = originalEnv.REM_EMBEDDING_BASE_URL;
    }
    if (originalEnv.REM_EMBEDDING_API_KEY === undefined) {
      delete process.env.REM_EMBEDDING_API_KEY;
    } else {
      process.env.REM_EMBEDDING_API_KEY = originalEnv.REM_EMBEDDING_API_KEY;
    }
    if (originalEnv.REM_EMBEDDING_MODEL === undefined) {
      delete process.env.REM_EMBEDDING_MODEL;
    } else {
      process.env.REM_EMBEDDING_MODEL = originalEnv.REM_EMBEDDING_MODEL;
    }
  });

  it("calls embeddings.create and returns the embedding vector", async () => {
    const calls = [];
    class FakeOpenAI {
      constructor(config) {
        calls.push({ type: "constructor", config });
        this.embeddings = {
          create: async (payload) => {
            calls.push({ type: "create", payload });
            return { data: [{ embedding: [0.1, 0.2, 0.3] }] };
          },
        };
      }
    }
    const restore = mockOpenAI(FakeOpenAI);
    process.env.REM_EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.REM_EMBEDDING_API_KEY = "test-key";
    process.env.REM_EMBEDDING_MODEL = "nomic-embed-text";

    try {
      const { embed } = require("../../llm/embedding_client");
      const embedding = await embed("hello");

      assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
      assert.deepEqual(calls[0], {
        type: "constructor",
        config: {
          apiKey: "test-key",
          baseURL: "http://localhost:11434/v1",
        },
      });
      assert.deepEqual(calls[1], {
        type: "create",
        payload: {
          model: "nomic-embed-text",
          input: "hello",
        },
      });
    } finally {
      restore();
    }
  });

  it("throws a clear error when required env vars are missing", async () => {
    delete process.env.REM_EMBEDDING_BASE_URL;
    process.env.REM_EMBEDDING_API_KEY = "test-key";
    const restore = mockOpenAI(class FakeOpenAI {});

    try {
      const { embed } = require("../../llm/embedding_client");
      await assert.rejects(
        () => embed("hello"),
        /missing REM_EMBEDDING_BASE_URL/
      );
    } finally {
      restore();
    }
  });

  it("embedBatch calls embed once per input", async () => {
    const inputs = [];
    class FakeOpenAI {
      constructor() {
        this.embeddings = {
          create: async (payload) => {
            inputs.push(payload.input);
            return { data: [{ embedding: [String(payload.input).length] }] };
          },
        };
      }
    }
    const restore = mockOpenAI(FakeOpenAI);
    process.env.REM_EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.REM_EMBEDDING_API_KEY = "test-key";

    try {
      const { embedBatch } = require("../../llm/embedding_client");
      const embeddings = await embedBatch(["a", "bb", "ccc"]);

      assert.deepEqual(inputs, ["a", "bb", "ccc"]);
      assert.deepEqual(embeddings, [[1], [2], [3]]);
    } finally {
      restore();
    }
  });
});
