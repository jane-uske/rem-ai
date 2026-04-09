const assert = require("assert").strict;
const path = require("path");

const { FakeWebSocket } = require("../../helpers/fake_ws");

async function waitFor(predicate, timeoutMs = 500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timeout after ${timeoutMs}ms`);
}

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

function loadPredictionSession(options = {}) {
  const restoreEnv = applyEnv({
    STT_PARTIAL_PREDICTION_ENABLED: options.predictionEnabled ?? "0",
    STT_PREDICTION_PUSH_ENABLED: options.predictionPushEnabled ?? "0",
    STT_PREDICTION_DEBOUNCE_MS: options.debounceMs ?? "0",
    VOICE_BACKCHANNEL_ENABLED: "0",
    REM_SILENCE_NUDGE_MS: "0",
    interrupt_reaction: "0",
  });

  const appStatePath = path.resolve(__dirname, "../../../infra/app_state.ts");
  const fastBrainPath = path.resolve(__dirname, "../../../brains/fast_brain.ts");
  const sessionPath = path.resolve(__dirname, "../../../server/session/index.ts");

  const appState = require(appStatePath);
  const previousDbReady = appState.isDbReady();
  const previousRedisReady = appState.isRedisReady();
  const previousMemoryMode = appState.getMemoryMode();
  appState.setDbReady(false);
  appState.setRedisReady(false);
  appState.setMemoryMode("in-memory");

  const fastBrainModule = require(fastBrainPath);
  const originalPredictOnly = fastBrainModule.fastBrainPredictOnly;
  const predictionCalls = [];

  fastBrainModule.fastBrainPredictOnly = async (...args) => {
    predictionCalls.push(args);
    return options.predictedReply ?? "预判回复";
  };

  delete require.cache[sessionPath];
  const { createSession } = require(sessionPath);
  const ws = new FakeWebSocket();
  const session = createSession(ws, {} as any);

  return {
    ws,
    session,
    predictionCalls,
    restore() {
      fastBrainModule.fastBrainPredictOnly = originalPredictOnly;
      appState.setDbReady(previousDbReady);
      appState.setRedisReady(previousRedisReady);
      appState.setMemoryMode(previousMemoryMode);
      restoreEnv();
      delete require.cache[sessionPath];
      ws.close();
    },
  };
}

describe("prediction budget gates", () => {
  it("does not run prediction or push debug previews when prediction is disabled", async () => {
    const { ws, session, predictionCalls, restore } = loadPredictionSession({
      predictionEnabled: "0",
      predictionPushEnabled: "1",
    });

    try {
      session.emitSttPartial("我想继续说一下");
      await new Promise((resolve) => setTimeout(resolve, 40));

      assert.equal(predictionCalls.length, 0);
      assert.equal(ws.parsedMessages().some((msg) => msg?.type === "stt_prediction"), false);
    } finally {
      restore();
    }
  });

  it("can run prediction without pushing previews when push is disabled", async () => {
    const { ws, session, predictionCalls, restore } = loadPredictionSession({
      predictionEnabled: "1",
      predictionPushEnabled: "0",
      predictedReply: "这是后台预判",
    });

    try {
      session.emitSttPartial("帮我继续这个话题");
      await waitFor(() => predictionCalls.length === 1);

      assert.equal(predictionCalls.length, 1);
      assert.equal(session.predictedReply, "这是后台预判");
      assert.equal(ws.parsedMessages().some((msg) => msg?.type === "stt_prediction"), false);
    } finally {
      restore();
    }
  });

  it("only pushes stt_prediction after prediction itself is enabled", async () => {
    const { ws, session, predictionCalls, restore } = loadPredictionSession({
      predictionEnabled: "1",
      predictionPushEnabled: "1",
      predictedReply: "预判命中",
    });

    try {
      session.emitSttPartial("这句话会触发预判");
      await waitFor(() =>
        ws.parsedMessages().some((msg) => msg?.type === "stt_prediction"),
      );

      const predictionMessages = ws.parsedMessages().filter((msg) => msg?.type === "stt_prediction");
      assert.equal(predictionCalls.length, 1);
      assert.equal(predictionMessages.length, 1);
      assert.equal(predictionMessages[0].status, "finished");
      assert.equal(predictionMessages[0].preview, "预判命中");
    } finally {
      restore();
    }
  });
});
