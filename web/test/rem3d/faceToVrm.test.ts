const { expect } = require("chai");
const { VRMExpressionPresetName } = require("@pixiv/three-vrm");
const {
  faceToExpressionWeights,
  lipSyncToExpressionWeights,
  visemeSignalToExpressionWeights,
} = require("../../src/lib/rem3d/faceToVrm");

describe("faceToVrm", () => {
  it("maps face overlays into blended brow and mouth expressions", () => {
    const weights = faceToExpressionWeights({
      browDownL: 0.8,
      browDownR: 0.6,
      mouthFrown: 0.5,
      mouthSmile: 0.3,
      mouthOpen: 0.4,
      mouthPucker: 0.25,
      eyeOpenL: 0.9,
      eyeOpenR: 0.7,
      eyeSquintL: 0.2,
      eyeSquintR: 0.1,
      cheekPuff: 0.15,
    });

    expect(weights[VRMExpressionPresetName.Angry]).to.be.closeTo(0.624, 0.001);
    expect(weights[VRMExpressionPresetName.Sad]).to.be.closeTo(0.425, 0.001);
    expect(weights[VRMExpressionPresetName.Happy]).to.be.closeTo(0.234, 0.001);
    expect(weights[VRMExpressionPresetName.Aa]).to.equal(0.4);
    expect(weights[VRMExpressionPresetName.Oh]).to.equal(0.25);
    expect(weights[VRMExpressionPresetName.Blink]).to.be.closeTo(0.2, 0.001);
    expect(weights[VRMExpressionPresetName.Relaxed]).to.be.closeTo(0.09, 0.001);
  });

  it("maps lip sync visemes to mouth presets", () => {
    expect(
      lipSyncToExpressionWeights({ time: 0, viseme: "aa", weight: 0.7 })[
        VRMExpressionPresetName.Aa
      ],
    ).to.equal(0.7);
    expect(
      lipSyncToExpressionWeights({ time: 0, viseme: "oh", weight: 0.6 })[
        VRMExpressionPresetName.Oh
      ],
    ).to.equal(0.6);
    expect(
      lipSyncToExpressionWeights({ time: 0, viseme: "sil", weight: 0.9 }),
    ).to.deep.equal({});
  });

  it("maps runtime viseme signals to mouth presets", () => {
    const weights = visemeSignalToExpressionWeights({
      name: "oo",
      weight: 0.55,
    });

    expect(weights[VRMExpressionPresetName.Oh]).to.equal(0.55);
  });
});
