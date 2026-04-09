const AUDIO_BIN_MAGIC_V2 = Buffer.from([0x52, 0x41, 0x55, 0x44]); // "RAUD"
const AUDIO_BIN_VERSION = 1;
const AUDIO_BIN_CODEC_PCM16_MONO = 1;
const AUDIO_BIN_HEADER_BYTES_V2 = 16;

function makeFrameFromSamples(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  return buf;
}

function makeSilenceFrame(samples = 320): Buffer {
  return Buffer.alloc(samples * 2);
}

function makeSineFrame(amplitude = 0.18, samples = 320, cycles = 4): Buffer {
  const values: number[] = [];
  for (let i = 0; i < samples; i++) {
    const phase = (i / samples) * Math.PI * 2 * cycles;
    values.push(Math.sin(phase) * amplitude);
  }
  return makeFrameFromSamples(values);
}

function makeSparseClickFrame(amplitude = 0.9, samples = 320, clickSpacing = 80): Buffer {
  const values = new Array(samples).fill(0);
  for (let i = 0; i < samples; i += clickSpacing) {
    const sign = (i / clickSpacing) % 2 === 0 ? 1 : -1;
    values[i] = sign * amplitude;
  }
  return makeFrameFromSamples(values);
}

function makeBroadbandNoiseFrame(amplitude = 0.16, samples = 320, seed = 1): Buffer {
  let x = seed >>> 0;
  const values: number[] = [];
  for (let i = 0; i < samples; i++) {
    x = (1664525 * x + 1013904223) >>> 0;
    const normalized = (x / 0xffffffff) * 2 - 1;
    values.push(normalized * amplitude);
  }
  return makeFrameFromSamples(values);
}

function makeRaudFrame(pcm: Buffer, sampleRate = 16_000): Buffer {
  const header = Buffer.alloc(AUDIO_BIN_HEADER_BYTES_V2);
  AUDIO_BIN_MAGIC_V2.copy(header, 0);
  header[4] = AUDIO_BIN_VERSION;
  header[5] = AUDIO_BIN_CODEC_PCM16_MONO;
  header.writeUInt32LE(sampleRate, 8);
  header.writeUInt32LE(pcm.length, 12);
  return Buffer.concat([header, pcm]);
}

function repeatFrames(frame: Buffer, count: number): Buffer[] {
  const frames: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(Buffer.from(frame));
  }
  return frames;
}

module.exports = {
  makeSilenceFrame,
  makeSineFrame,
  makeSparseClickFrame,
  makeBroadbandNoiseFrame,
  makeRaudFrame,
  repeatFrames,
};
