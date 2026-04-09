const assert = require("assert").strict;
const {
  decideTurnTaking,
  chooseBackchannelText,
  getMeaningfulTurnPreview,
  isTentativeSpeechText,
  evaluateBackchannelDecision,
  shouldOfferThinkingPauseBackchannel,
  shouldSuppressFallbackNoiseUtterance,
  shouldSuppressStrictNoPreviewUtterance,
  strongFrameRatio,
} = require("../../../server/session/turn_taking");

describe("turn taking stage2", () => {
  const baseInput = {
    baseGapMs: 220,
    nowMs: 10_000,
    lastPartialUpdateAt: 9_400,
    lastGrowthAt: 9_400,
    hesitationHoldMs: 980,
    growthHoldMs: 720,
    likelyStableMs: 680,
    confirmedStableMs: 1_100,
    releaseMs: 60,
    minGapMs: 80,
  };

  it("holds on short pause when partial is still growing", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我觉得这个事情然后",
      lastPartialUpdateAt: 9_760,
      lastGrowthAt: 9_760,
    });

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 720);
    assert.equal(decision.recentGrowth, true);
    assert.ok(decision.reasons.includes("recent_growth"));
  });

  it("marks punctuated stable sentence as confirmed end", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我今天有点累了。",
      lastPartialUpdateAt: 8_800,
      lastGrowthAt: 8_600,
    });

    assert.equal(decision.state, "CONFIRMED_END");
    assert.equal(decision.gapMs, 160);
    assert.equal(decision.sentenceClosed, true);
  });

  it("keeps semantic but unpunctuated ending at likely end", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我们晚上聊可以吗",
      lastPartialUpdateAt: 9_320,
      lastGrowthAt: 8_900,
    });

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.semanticallyComplete, true);
    assert.equal(decision.gapMs, 190);
  });

  it("falls back when preview is only recording placeholder", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "录音中… 1.4s",
      lastPartialUpdateAt: 0,
      lastGrowthAt: 0,
    });

    assert.equal(getMeaningfulTurnPreview("录音中… 1.4s"), "");
    assert.equal(decision.state, "CONFIRMED_END");
    assert.equal(decision.gapMs, 220);
    assert.equal(decision.usedFallback, true);
  });

  it("treats hesitation filler as hold", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "嗯嗯",
      lastPartialUpdateAt: 9_600,
      lastGrowthAt: 9_200,
    });

    assert.equal(isTentativeSpeechText("嗯嗯"), true);
    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 980);
  });

  it("holds incomplete long clause until it is stable enough", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我现在想优化 rem 的语音体验",
      lastPartialUpdateAt: 9_180,
      lastGrowthAt: 9_180,
    });

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 720);
    assert.ok(decision.reasons.includes("incomplete_clause_not_stable"));
  });

  it("holds on continuation cue for the reported sentence pattern", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我现在想优化 rem 的语音体验，但是我不确定应该先改 stt 还是先改",
      lastPartialUpdateAt: 9_120,
      lastGrowthAt: 9_120,
    });

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 720);
    assert.ok(decision.reasons.includes("continuation_cue"));
  });

  it("holds open clause tails such as 但是 before the user finishes the sentence", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我现在想优化 rem 的语音体验，但是",
      lastPartialUpdateAt: 9_050,
      lastGrowthAt: 8_900,
    });

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 720);
    assert.ok(decision.reasons.includes("open_clause_tail"));
  });

  it("offers a light backchannel on a stable thinking pause", () => {
    assert.equal(
      shouldOfferThinkingPauseBackchannel({
        state: "HOLD",
        previewText: "我觉得这个事情但是",
        stableMs: 1400,
        recentGrowth: false,
        semanticallyComplete: false,
        incompleteTail: true,
        minStableMs: 1100,
        minPreviewChars: 6,
      }),
      true,
    );
  });

  it("does not offer a backchannel while the partial is still actively growing", () => {
    assert.equal(
      shouldOfferThinkingPauseBackchannel({
        state: "HOLD",
        previewText: "我觉得这个事情但是",
        stableMs: 400,
        recentGrowth: true,
        semanticallyComplete: false,
        incompleteTail: true,
        minStableMs: 1100,
        minPreviewChars: 6,
      }),
      false,
    );
  });

  it("chooses a softer thinking-pause acknowledgement for shy and sad emotions", () => {
    assert.equal(chooseBackchannelText("shy", true), "嗯…你继续");
    assert.equal(chooseBackchannelText("sad", true), "我在听");
  });

  it("chooses brighter thinking-pause acknowledgements for happy and curious emotions", () => {
    assert.equal(chooseBackchannelText("happy", true), "你继续");
    assert.equal(chooseBackchannelText("curious", true), "然后呢");
  });

  it("returns a thinking_pause backchannel decision with emotion-aware text", () => {
    const decision = evaluateBackchannelDecision({
      emotion: "curious",
      state: "HOLD",
      previewText: "我想先说语音这一块但是",
      stableMs: 1500,
      recentGrowth: false,
      semanticallyComplete: false,
      incompleteTail: true,
      cooldownStableMs: 1100,
      minPreviewChars: 6,
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, "thinking_pause");
    assert.equal(decision.text, "然后呢");
  });

  it("suppresses backchannel decisions while cooldown is active", () => {
    const decision = evaluateBackchannelDecision({
      emotion: "neutral",
      state: "LIKELY_END",
      previewText: "我们晚上继续聊可以吗",
      stableMs: 1600,
      recentGrowth: false,
      semanticallyComplete: true,
      incompleteTail: false,
      cooldownActive: true,
      cooldownStableMs: 1100,
      minPreviewChars: 6,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "cooldown");
  });

  it("suppresses short fallback-only utterances with no preview", () => {
    assert.equal(
      shouldSuppressFallbackNoiseUtterance({
        vadMode: "fallback_energy",
        previewText: "",
        speechDurationMs: 660,
        suppressionMaxMs: 900,
      }),
      true,
    );
  });

  it("keeps fallback utterances when meaningful preview already exists", () => {
    assert.equal(
      shouldSuppressFallbackNoiseUtterance({
        vadMode: "fallback_energy",
        previewText: "你记得我刚才说过什么吗",
        speechDurationMs: 660,
        suppressionMaxMs: 900,
      }),
      false,
    );
  });

  it("suppresses fallback hallucinations with weak rms and tiny final text", () => {
    assert.equal(
      shouldSuppressFallbackNoiseUtterance({
        vadMode: "fallback_energy",
        previewText: "",
        speechDurationMs: 1280,
        suppressionMaxMs: 900,
        utteranceMaxRms: 0.021,
        minUtteranceRms: 0.035,
        utteranceFrameCount: 64,
        utteranceStrongFrames: 0,
        minStrongFrames: 2,
        minStrongRatio: 0.08,
        recognizedText: "是",
        tinyTextMaxChars: 1,
      }),
      true,
    );
  });

  it("suppresses fallback hallucinations with weak speech shape even when the final text is long", () => {
    assert.equal(
      shouldSuppressFallbackNoiseUtterance({
        vadMode: "fallback_energy",
        previewText: "",
        speechDurationMs: 2860,
        suppressionMaxMs: 900,
        utteranceMaxRms: 0.0306,
        minUtteranceRms: 0.035,
        utteranceFrameCount: 140,
        utteranceStrongFrames: 0,
        minStrongFrames: 2,
        minStrongRatio: 0.08,
        recognizedText: "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目",
        tinyTextMaxChars: 1,
      }),
      true,
    );
  });

  it("keeps stronger fallback utterances even when final text is short", () => {
    assert.equal(
      shouldSuppressFallbackNoiseUtterance({
        vadMode: "fallback_energy",
        previewText: "",
        speechDurationMs: 1280,
        suppressionMaxMs: 900,
        utteranceMaxRms: 0.052,
        minUtteranceRms: 0.035,
        recognizedText: "嗯",
        tinyTextMaxChars: 1,
      }),
      false,
    );
  });

  it("suppresses strict no-preview utterances with weak strong-frame shape", () => {
    assert.equal(
      shouldSuppressStrictNoPreviewUtterance({
        vadMode: "strict",
        previewText: "",
        utteranceFrameCount: 120,
        utteranceStrongFrames: 6,
        minStrongFrames: 8,
        minStrongRatio: 0.22,
      }),
      true,
    );
  });

  it("keeps strict no-preview utterances when the speech shape is strong", () => {
    assert.equal(
      shouldSuppressStrictNoPreviewUtterance({
        vadMode: "strict",
        previewText: "",
        utteranceFrameCount: 100,
        utteranceStrongFrames: 34,
        minStrongFrames: 8,
        minStrongRatio: 0.22,
      }),
      false,
    );
  });

  it("suppresses strict hallucinations when weak speech shape yields tiny final text", () => {
    assert.equal(
      shouldSuppressStrictNoPreviewUtterance({
        vadMode: "strict",
        previewText: "",
        utteranceFrameCount: 129,
        utteranceStrongFrames: 7,
        minStrongFrames: 8,
        minStrongRatio: 0.22,
        recognizedText: "词曲 李宗盛",
        tinyTextMaxChars: 5,
      }),
      true,
    );
  });

  it("computes strong frame ratios defensively", () => {
    assert.equal(strongFrameRatio(0, 5), 0);
    assert.equal(strongFrameRatio(100, 25), 0.25);
  });
});
