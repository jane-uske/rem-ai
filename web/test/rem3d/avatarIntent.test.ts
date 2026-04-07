const { expect } = require("chai");
const { deriveAvatarIntent } = require("../../src/lib/rem3d/avatarIntent");

describe("deriveAvatarIntent", () => {
  it("maps happy emotion to a hop intent with upbeat defaults", () => {
    const intent = deriveAvatarIntent({
      emotion: "happy",
      source: "server",
    });

    expect(intent).to.include({
      emotion: "happy",
      gesture: "happy_hop",
      facialAccent: "soft_smile",
      energy: 3,
      source: "server",
    });
    expect(intent.gestureIntensity).to.equal(3);
    expect(intent.holdMs).to.equal(820);
  });

  it("maps sad inputs to an inward, furrowed intent", () => {
    const intent = deriveAvatarIntent({
      emotion: "sad",
      face: {
        browDownL: 0.7,
        browDownR: 0.6,
        mouthFrown: 0.5,
      },
      source: "debug",
    });

    expect(intent).to.include({
      emotion: "sad",
      gesture: "shrink_in",
      facialAccent: "brow_furrow",
      energy: 0,
      source: "debug",
    });
    expect(intent.gestureIntensity).to.equal(2);
  });

  it("preserves explicit action gestures and upgrades eyebrow raise to a facial accent", () => {
    const intent = deriveAvatarIntent({
      emotion: "neutral",
      action: {
        action: "eyebrow_raise",
        intensity: 1.8,
        duration: 960,
      },
      source: "llm",
      reason: "surprised-beat",
    });

    expect(intent).to.include({
      emotion: "neutral",
      gesture: "none",
      facialAccent: "brow_raise",
      energy: 1,
      source: "llm",
      reason: "surprised-beat",
    });
    expect(intent.gestureIntensity).to.equal(2);
    expect(intent.holdMs).to.equal(960);
  });

  it("keeps supported action gestures instead of replacing them with emotion defaults", () => {
    const intent = deriveAvatarIntent({
      emotion: "curious",
      action: {
        action: "shrug",
        intensity: 2.2,
        duration: 1200,
      },
    });

    expect(intent.gesture).to.equal("shrug");
    expect(intent.gestureIntensity).to.equal(2);
    expect(intent.holdMs).to.equal(1200);
  });
});
