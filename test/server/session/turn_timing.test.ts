const assert = require("assert").strict;
const { buildTurnTimingSnapshot } = require("../../../server/session/turn_timing");

describe("turn timing snapshot", () => {
  it("computes transition and per-stage deltas from a timestamp snapshot", () => {
    const snapshot = buildTurnTimingSnapshot({
      previousState: "listening_hold",
      nextState: "assistant_speaking",
      reason: "playback_start",
      nowMs: 1_500,
      stateEnteredAtMs: 1_000,
      speechStartAtMs: 100,
      speechEndAtMs: 700,
      sttFinalAtMs: 1_100,
      assistantEnterAtMs: 1_300,
      playbackStartAtMs: 1_450,
      partialGrowthAtMs: 900,
      partialUpdateAtMs: 950,
    });

    assert.equal(snapshot.transition, "listening_hold->assistant_speaking");
    assert.equal(snapshot.reason, "playback_start");
    assert.equal(snapshot.stateAgeMs, 500);
    assert.equal(snapshot.sinceSpeechStartMs, 1_400);
    assert.equal(snapshot.sinceSpeechEndMs, 800);
    assert.equal(snapshot.sinceSttFinalMs, 400);
    assert.equal(snapshot.sinceAssistantEnterMs, 200);
    assert.equal(snapshot.sincePlaybackStartMs, 50);
    assert.equal(snapshot.sincePartialGrowthMs, 600);
    assert.equal(snapshot.sincePartialUpdateMs, 550);
    assert.equal(snapshot.speechEndToAssistantEnterMs, 600);
    assert.equal(snapshot.assistantEnterToPlaybackMs, 150);
  });

  it("omits future or missing timestamps", () => {
    const snapshot = buildTurnTimingSnapshot({
      previousState: null,
      nextState: "confirmed_end",
      reason: "confirmed_end",
      nowMs: 1_000,
      stateEnteredAtMs: null,
      speechStartAtMs: null,
      speechEndAtMs: 1_100,
      sttFinalAtMs: null,
      assistantEnterAtMs: null,
      playbackStartAtMs: null,
      partialGrowthAtMs: null,
      partialUpdateAtMs: null,
    });

    assert.equal(snapshot.transition, "none->confirmed_end");
    assert.equal(snapshot.stateAgeMs, undefined);
    assert.equal(snapshot.sinceSpeechEndMs, undefined);
    assert.equal(snapshot.speechEndToAssistantEnterMs, undefined);
  });
});
