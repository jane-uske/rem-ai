/**
 * Capture raw PCM Int16 mono 16 kHz from the microphone.
 *
 * Uses ScriptProcessorNode (wide browser support) to grab Float32 samples
 * from the mic, downsample to 16 kHz, convert to Int16 LE, and invoke
 * the onChunk callback with a base64-encoded string every ~50 ms.
 */

const TARGET_RATE = 16000;
const BUFFER_SIZE = 2048; // ~43 ms at 48 kHz

export interface PcmCapture {
  stop: () => void;
  sampleRate: number;
}

export function startPcmCapture(
  stream: MediaStream,
  onChunk: (base64: string) => void,
): PcmCapture {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);

  // ScriptProcessorNode is deprecated but universally supported.
  // AudioWorklet would be ideal for production.
  const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);

  const nativeRate = ctx.sampleRate;

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const pcm16 = downsampleToInt16(input, nativeRate, TARGET_RATE);
    onChunk(bufferToBase64(pcm16));
  };

  source.connect(processor);
  processor.connect(ctx.destination);

  return {
    sampleRate: TARGET_RATE,
    stop() {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

function downsampleToInt16(
  float32: Float32Array,
  fromRate: number,
  toRate: number,
): ArrayBuffer {
  const ratio = fromRate / toRate;
  const outLen = Math.round(float32.length / ratio);
  const buf = new ArrayBuffer(outLen * 2);
  const view = new DataView(buf);

  for (let i = 0; i < outLen; i++) {
    const srcIdx = Math.min(Math.round(i * ratio), float32.length - 1);
    let s = float32[srcIdx];
    s = Math.max(-1, Math.min(1, s));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
