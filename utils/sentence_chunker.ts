const SENTENCE_END = /[。！？.!?\n]/;

/**
 * Stateful chunker: feed tokens via push(), get back complete sentences.
 * Call flush() after the stream ends to get any remaining text.
 */
export class SentenceChunker {
  private buffer = "";

  push(token: string): string[] {
    this.buffer += token;
    const sentences: string[] = [];

    let match: RegExpExecArray | null;
    while ((match = SENTENCE_END.exec(this.buffer)) !== null) {
      const idx = match.index + match[0].length;
      const sentence = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx);
      if (sentence) sentences.push(sentence);
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
