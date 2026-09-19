/** Pessimistic token estimate, about 3 bytes per token, with no tokenizer (`plans/large-diffs.md`). */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 3);
}
