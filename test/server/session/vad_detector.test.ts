const assert = require("assert").strict;
const { VadDetector } = require("../../../voice/vad_detector");

function makeSineFrame(amplitude = 0.18, samples = 320, cycles = 4) {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const phase = (i / samples) * Math.PI * 2 * cycles;
    const value = Math.sin(phase) * amplitude;
    buf.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  return buf;
}

function makeSparseClickFrame(amplitude = 0.9, samples = 320, clickSpacing = 80) {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += clickSpacing) {
    const sign = (i / clickSpacing) % 2 === 0 ? 1 : -1;
    buf.writeInt16LE(Math.round(sign * amplitude * 32767), i * 2);
  }
  return buf;
}

describe("VadDetector", () => {
  it("starts speech on sustained speech-like frames", () => {
    const vad = new VadDetector();
    let starts = 0;
    vad.on("speech_start", () => {
      starts += 1;
    });

    const frame = makeSineFrame();
    vad.feed(frame);
    vad.feed(frame);
    vad.feed(frame);

    assert.equal(starts, 1);
    assert.equal(vad.speaking, true);
  });

  it("does not start speech on sparse impulsive click frames", () => {
    const vad = new VadDetector();
    let starts = 0;
    vad.on("speech_start", () => {
      starts += 1;
    });

    const frame = makeSparseClickFrame();
    for (let i = 0; i < 8; i++) {
      vad.feed(frame);
    }

    assert.equal(starts, 0);
    assert.equal(vad.speaking, false);
  });
});
