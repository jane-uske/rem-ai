import type { Emotion } from "./tts_emotion";
import { textToSpeech, isTtsEnabled } from "./tts";

export { isTtsEnabled };

/**
 * Synthesize a single sentence to audio.
 * Accepts an optional AbortSignal — rejects immediately if already aborted,
 * allowing the pipeline to skip remaining sentences on interrupt.
 */
export async function synthesize(
  sentence: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  if (signal?.aborted) throw new DOMException("TTS aborted", "AbortError");
  return textToSpeech(sentence, signal, emotion);
}
