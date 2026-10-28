// Recursive character splitter (same strategy as LangChain's RecursiveCharacterTextSplitter):
// split on the coarsest separator first, merge pieces up to chunkSize, carry chunkOverlap forward.

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const chunkSize = options.chunkSize ?? 1000;
  const chunkOverlap = options.chunkOverlap ?? 200;
  if (chunkOverlap >= chunkSize) throw new Error("chunkOverlap must be smaller than chunkSize");
  return split(text, options.separators ?? DEFAULT_SEPARATORS, chunkSize, chunkOverlap);
}

function split(text: string, separators: string[], size: number, overlap: number): string[] {
  const sepIndex = separators.findIndex((s) => s === "" || text.includes(s));
  const sep = separators[sepIndex] ?? "";
  const finer = separators.slice(sepIndex + 1);

  // Keep the separator attached to the end of each piece so sentences keep their punctuation.
  const pieces =
    sep === ""
      ? Array.from(text)
      : text.split(sep).map((p, i, all) => (i < all.length - 1 ? p + sep : p));

  const chunks: string[] = [];
  let small: string[] = [];
  for (const piece of pieces) {
    if (!piece) continue;
    if (piece.length <= size) {
      small.push(piece);
      continue;
    }
    if (small.length) chunks.push(...merge(small, size, overlap));
    small = [];
    if (finer.length) chunks.push(...split(piece, finer, size, overlap));
    else chunks.push(piece);
  }
  if (small.length) chunks.push(...merge(small, size, overlap));
  return chunks;
}

function merge(pieces: string[], size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let total = 0;
  for (const piece of pieces) {
    if (total + piece.length > size && current.length) {
      pushChunk(chunks, current.join(""));
      // Drop from the front until what's left fits the overlap window and leaves room for `piece`.
      while (current.length && (total > overlap || total + piece.length > size)) {
        total -= current.shift()!.length;
      }
    }
    current.push(piece);
    total += piece.length;
  }
  pushChunk(chunks, current.join(""));
  return chunks;
}

function pushChunk(chunks: string[], chunk: string) {
  const trimmed = chunk.trim();
  if (trimmed) chunks.push(trimmed);
}
