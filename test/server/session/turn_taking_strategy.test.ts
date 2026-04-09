const assert = require("assert").strict;

const {
  decideTurnTaking,
} = require("../../../server/session/turn_taking");

function makeInput(overrides = {}) {
  return {
    baseGapMs: 180,
    previewText: "",
    nowMs: 2000,
    lastPartialUpdateAt: 1000,
    lastGrowthAt: 1000,
    hesitationHoldMs: 980,
    growthHoldMs: 720,
    likelyStableMs: 680,
    confirmedStableMs: 1100,
    releaseMs: 60,
    minGapMs: 80,
    ...overrides,
  };
}

describe("turn taking strategy", () => {
  it("keeps HOLD for clause-break tails even when the partial looks stable", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "我先说一个重点，",
        lastPartialUpdateAt: 500,
        lastGrowthAt: 500,
      }),
    );

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 720);
    assert.equal(decision.reasons.includes("clause_break_tail"), true);
  });

  it("keeps HOLD for open tails during thinking pauses", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "然后我想",
        lastPartialUpdateAt: 500,
        lastGrowthAt: 500,
      }),
    );

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.reasons.includes("open_clause_tail"), true);
  });

  it("releases faster for semantically complete endings without punctuation", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "这样可以吗",
        lastPartialUpdateAt: 1200,
        lastGrowthAt: 1200,
      }),
    );

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.semanticallyComplete, true);
    assert.equal(decision.sentenceClosed, false);
    assert.equal(decision.gapMs, 120);
  });

  it("documents the no-preview fallback path", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "录音中… 1.2s",
        lastPartialUpdateAt: 0,
        lastGrowthAt: 0,
      }),
    );

    assert.equal(decision.state, "CONFIRMED_END");
    assert.equal(decision.usedFallback, true);
    assert.deepEqual(decision.reasons, ["fallback:no_partial"]);
  });
});
