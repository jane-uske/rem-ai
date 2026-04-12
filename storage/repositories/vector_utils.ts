export function parseEmbedding(val: unknown): number[] | null {
  if (val == null) {
    return null;
  }
  if (Array.isArray(val)) {
    return val as number[];
  }
  if (typeof val === 'string') {
    return JSON.parse(val) as number[];
  }
  return null;
}

export function embeddingToVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
