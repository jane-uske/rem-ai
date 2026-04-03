const SENTENCE_END = /[。！？.!?\n]/;
const CLAUSE_END = /[。！？.!?\n，,；;、]/;

/**
 * Stateful chunker: feed tokens via push(), get back complete sentences.
 * Call flush() after the stream ends to get any remaining text.
 *
 * Supports "eager" mode that also breaks on clause boundaries (commas, etc.)
 * — useful for the first chunk to reduce time-to-first-audio.
 */
export class SentenceChunker {
  private buffer = "";
  private _eager = false;
  private readonly eagerCharThreshold = 20;

  /**
   * When eager is true, also break on clause-level punctuation
   * (，,；;、) in addition to sentence-end punctuation.
   * Call setEager(false) after the first sentence for normal behavior.
   */
  setEager(eager: boolean): void {
    this._eager = eager;
  }

  push(token: string): string[] {
    this.buffer += token;
    const sentences: string[] = [];
    const pattern = this._eager ? CLAUSE_END : SENTENCE_END;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(this.buffer)) !== null) {
      const idx = match.index + match[0].length;
      const sentence = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx);
      if (sentence) sentences.push(sentence);
    }

    if (this._eager && this.buffer.length >= this.eagerCharThreshold) {
      sentences.push(this.buffer.trim());
      this.buffer = "";
    }

    return sentences;
  }

  flush(): string {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest;
  }

  /** Discard buffered text (used on interrupt). */
  reset(): void {
    this.buffer = "";
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
