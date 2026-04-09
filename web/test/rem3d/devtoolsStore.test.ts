const { expect } = require("chai");
const {
  clearAvatarDevtoolsLogs,
  getAvatarDevtoolsState,
  mergeAvatarRuntimeSnapshot,
  publishAvatarRuntimeSnapshot,
  pushAvatarDevtoolsLog,
} = require("../../src/lib/rem3d/devtoolsStore");

describe("devtoolsStore", () => {
  beforeEach(() => {
    clearAvatarDevtoolsLogs();
    publishAvatarRuntimeSnapshot({
      ts: 0,
      emotion: "neutral",
      remState: "idle",
      voiceActive: false,
      lipEnvelope: 0,
      expressionWeights: {},
      activeAction: null,
      activeCue: null,
      runtimeState: "idle",
      intent: null,
    });
  });

  it("stores runtime snapshots without clearing them when logs are reset", () => {
    pushAvatarDevtoolsLog("system", "boot");
    clearAvatarDevtoolsLogs();

    const state = getAvatarDevtoolsState();
    expect(state.logs).to.have.length(0);
    expect(state.snapshot).to.not.equal(null);
    expect(state.snapshot?.emotion).to.equal("neutral");
  });

  it("keeps only the most recent 180 log entries", () => {
    for (let i = 0; i < 220; i++) {
      pushAvatarDevtoolsLog("runtime", `entry-${i}`, { i });
    }

    const state = getAvatarDevtoolsState();
    expect(state.logs).to.have.length(180);
    expect(state.logs[0]?.summary).to.equal("entry-40");
    expect(state.logs.at(-1)?.summary).to.equal("entry-219");
  });

  it("updates the latest runtime snapshot", () => {
    publishAvatarRuntimeSnapshot({
      ts: 123,
      emotion: "happy",
      remState: "speaking",
      voiceActive: true,
      lipEnvelope: 0.68,
      expressionWeights: { Happy: 0.8 },
      activeAction: {
        action: "wave",
        intensity: 0.9,
        duration: 900,
      },
      activeCue: "happy_hop",
      runtimeState: "ready",
      intent: {
        emotion: "happy",
        gesture: "happy_hop",
        gestureIntensity: 3,
        facialAccent: "soft_smile",
        energy: 3,
        holdMs: 820,
        source: "debug",
      },
    });

    const state = getAvatarDevtoolsState();
    expect(state.snapshot).to.deep.include({
      ts: 123,
      emotion: "happy",
      remState: "speaking",
      voiceActive: true,
      lipEnvelope: 0.68,
      activeCue: "happy_hop",
      runtimeState: "ready",
    });
    expect(state.snapshot?.activeAction?.action).to.equal("wave");
    expect(state.snapshot?.intent?.gesture).to.equal("happy_hop");
  });

  it("merges turn-state fields into the latest runtime snapshot", () => {
    mergeAvatarRuntimeSnapshot({
      ts: 456,
      turnState: "assistant_entering",
      turnReason: "tts_prepare",
      turnStateAtMs: 420,
      sttPredictionPreview: "我刚刚在想",
      interruptionType: "continuation",
    });

    const state = getAvatarDevtoolsState();
    expect(state.snapshot).to.deep.include({
      ts: 456,
      turnState: "assistant_entering",
      turnReason: "tts_prepare",
      turnStateAtMs: 420,
      sttPredictionPreview: "我刚刚在想",
      interruptionType: "continuation",
    });
  });
});
