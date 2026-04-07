const SENTENCE_END = /[。！？.!?\n]/;

/** 支持的首句 eager 阈值方案：12/14/16 字，默认 14（速度与自然度平衡） */
type EagerThresholdOption = 12 | 14 | 16;

export interface SentenceChunkerOptions {
  /**
   * Eager mode: emit first TTS chunk when this many characters are buffered
   * and no sentence end yet (does NOT split on commas).
   * Supported values: 12/14/16 (default: 14, balance of speed and naturalness)
   */
  eagerCharThreshold?: EagerThresholdOption | number;
  /**
   * While eager mode is on, allow a shorter minimum chunk so the first audio
   * can start earlier. Falls back to minTtsChars when not provided.
   */
  eagerMinTtsChars?: number;
  /**
   * After eager is off: if text has no sentence-ending punctuation, force a
   * chunk at this length so TTS does not wait forever.
   */
  maxChunkChars?: number;
  /**
   * Do not send a TTS chunk shorter than this (e.g. "哇！" alone), except at
   * stream end. Short pieces are held and prepended to the next chunk.
   * Set to 0 to disable. Default from env TTS_MIN_CHARS or 16.
   */
  minTtsChars?: number;
}

/**
 * Stateful chunker: feed tokens via push(), get back chunks for TTS.
 * Call flush() after the stream ends to get any remaining text.
 *
 * Splits only on sentence-ending punctuation (。！？.!? newline), never on
 * commas. Uses character thresholds for early first audio and for long runs
 * without a period. Merges segments shorter than minTtsChars into the next
 * chunk so TTS does not play a tiny clip then pause waiting for synthesis.
 */
export class SentenceChunker {
  private buffer = "";
  /** Leftover too short to TTS alone; prepended to the next emitted chunk. */
  private hold = "";
  private _eager = false;
  private readonly eagerCharThreshold: number;
  private readonly eagerMinTtsChars: number;
  private readonly maxChunkChars: number;
  private readonly minTtsChars: number;

  constructor(opts: SentenceChunkerOptions = {}) {
    const envMin = process.env.TTS_CHUNK_MIN_CHARS
      ? Number(process.env.TTS_CHUNK_MIN_CHARS)
      : NaN;
    const envEagerMin = process.env.TTS_EAGER_MIN_CHARS
      ? Number(process.env.TTS_EAGER_MIN_CHARS)
      : NaN;
    const envEagerChunk = process.env.TTS_EAGER_CHUNK_CHARS
      ? Number(process.env.TTS_EAGER_CHUNK_CHARS)
      : NaN;
    const envEagerThreshold = process.env.TTS_EAGER_THRESHOLD
      ? Number(process.env.TTS_EAGER_THRESHOLD) as EagerThresholdOption
      : 14;
    const envMax = process.env.TTS_CHUNK_MAX_CHARS
      ? Number(process.env.TTS_CHUNK_MAX_CHARS)
      : NaN;
    const envTtsMin = process.env.TTS_MIN_CHARS ? Number(process.env.TTS_MIN_CHARS) : NaN;

    // 优先使用显式传入的 eagerCharThreshold，否则检查 envEagerChunk，再用默认 14
    const desiredThreshold = opts.eagerCharThreshold ??
      (Number.isFinite(envEagerChunk) && envEagerChunk > 0 ? envEagerChunk : envEagerThreshold);
    // 强制阈值落在 12/14/16 范围内，避免不合理值
    this.eagerCharThreshold = [12,14,16].includes(desiredThreshold as EagerThresholdOption)
      ? desiredThreshold
      : 14;

    this.maxChunkChars =
      opts.maxChunkChars ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : 120);
    if (opts.minTtsChars !== undefined) {
      this.minTtsChars = opts.minTtsChars;
    } else if (Number.isFinite(envTtsMin) && envTtsMin >= 0) {
      this.minTtsChars = envTtsMin;
    } else {
      this.minTtsChars = 16;
    }
    if (opts.eagerMinTtsChars !== undefined) {
      this.eagerMinTtsChars = opts.eagerMinTtsChars;
    } else if (Number.isFinite(envEagerMin) && envEagerMin >= 0) {
      this.eagerMinTtsChars = envEagerMin;
    } else {
      this.eagerMinTtsChars = 8;
    }
  }

  /**
   * When eager is true, the first chunk may flush at eagerCharThreshold chars
   * (no comma breaks). Call setEager(false) after the first chunk for normal
   * sentence-end + maxChunkChars behavior.
   */
  setEager(eager: boolean): void {
    this._eager = eager;
  }

  push(token: string): string[] {
    this.buffer += token;
    const sentences: string[] = [];

    // 优先按自然短句标点（。！？…）触发合成，优先级高于字数阈值
    let match: RegExpExecArray | null;
    while ((match = SENTENCE_END.exec(this.buffer)) !== null) {
      const idx = match.index + match[0].length;
      const sentence = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx);
      SENTENCE_END.lastIndex = 0;
      if (sentence) sentences.push(sentence);
    }

    // 只有当没有标点触发时，才使用字数阈值强制输出首句
    if (this._eager && this.buffer.length >= this.eagerCharThreshold && sentences.length === 0) {
      sentences.push(this.buffer.trim());
      this.buffer = "";
    } else if (!this._eager) {
      while (this.buffer.length >= this.maxChunkChars) {
        const chunk = this.buffer.slice(0, this.maxChunkChars).trim();
        this.buffer = this.buffer.slice(this.maxChunkChars);
        if (chunk) sentences.push(chunk);
      }
    }

    return this.applyMinTtsLength(sentences);
  }

  /** Merge held text with outgoing chunks; hold fragments shorter than minTtsChars. */
  private applyMinTtsLength(chunks: string[]): string[] {
    const minChars = this._eager ? this.eagerMinTtsChars : this.minTtsChars;
    if (minChars <= 0) return chunks;

    const out: string[] = [];
    for (const c of chunks) {
      if (!c) continue;
      const piece = this.hold + c;
      if (piece.length >= minChars) {
        out.push(piece);
        this.hold = "";
      } else {
        this.hold = piece;
      }
    }
    return out;
  }

  flush(): string {
    const rest = this.buffer.trim();
    this.buffer = "";
    const merged = (this.hold + rest).trim();
    this.hold = "";
    return merged;
  }

  /** Discard buffered text (used on interrupt). */
  reset(): void {
    this.buffer = "";
    this.hold = "";
    this._eager = false;
  }
}

/**
 * Async generator: pipe a token stream through and receive complete sentences.
 */
export async function* chunkSentences(
  tokens: AsyncIterable<string>,
): AsyncGenerator<string> {
  const chunker = new SentenceChunker();

  for await (const token of tokens) {
    for (const sentence of chunker.push(token)) {
      yield sentence;
    }
  }

  const rest = chunker.flush();
  if (rest) yield rest;
}
