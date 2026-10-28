import type { ChunkSource, IndexedChunk, RetrievedChunk, VectorIndex } from "./types";
import { Bm25 } from "./bm25";

// Brute-force cosine search. A few thousand 384-d vectors score in a few milliseconds,
// so there is no need for FAISS (or a native module) on the phone.

/** Packs chunks and their embeddings into a VectorIndex (unit-normalized, one flat Float32 buffer). */
export function createIndex(
  meta: Pick<VectorIndex, "embeddingModel" | "createdAt">,
  items: (Omit<IndexedChunk, "id"> & { vector: ArrayLike<number> })[],
): VectorIndex {
  const dim = items[0]?.vector.length ?? 0;
  const vectors = new Float32Array(items.length * dim);
  const chunks = items.map(({ vector, ...chunk }, id) => {
    if (vector.length !== dim) throw new Error(`Chunk ${id} has dim ${vector.length}, expected ${dim}`);
    vectors.set(normalize(vector), id * dim);
    return { id, ...chunk };
  });
  return { ...meta, dim, chunks, vectors };
}

export function normalize(v: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(v);
  let norm = 0;
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

const NEAR_DUPLICATE = 0.97;

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let d = 0; d < a.length; d++) sum += a[d] * b[d];
  return sum;
}

export interface SearchFilter {
  tickers?: string[];
  /** Only each company's most recent filing (for "last quarter" / "latest" questions). */
  latestOnly?: boolean;
}

// Reciprocal rank fusion constant: the standard value, damps the influence of any single top rank.
const RRF_K = 60;

export class VectorStore {
  private readonly vectors: Float32Array[];
  private readonly bm25: Bm25;
  /** Newest filing date per ticker (ISO dates compare correctly as strings). */
  private readonly latestFiledAt = new Map<string, string>();

  constructor(private readonly index: VectorIndex) {
    if (index.vectors.length !== index.chunks.length * index.dim) {
      throw new Error(`Index has ${index.vectors.length} floats, expected ${index.chunks.length} chunks × ${index.dim} dims`);
    }
    // Views into the shared buffer (no copies). Vectors are unit-normalized when the index is built.
    this.vectors = index.chunks.map((_, i) => index.vectors.subarray(i * index.dim, (i + 1) * index.dim));
    this.bm25 = new Bm25(index.chunks.map((c) => c.text));
    for (const { source } of index.chunks) {
      const latest = this.latestFiledAt.get(source.ticker);
      if (!latest || source.filedAt > latest) this.latestFiledAt.set(source.ticker, source.filedAt);
    }
  }

  get size(): number {
    return this.index.chunks.length;
  }

  /** Distinct companies in the index, used to spot which ones a query mentions. */
  get companies(): Pick<ChunkSource, "ticker" | "company">[] {
    const seen = new Map<string, string>();
    for (const c of this.index.chunks) seen.set(c.source.ticker, c.source.company);
    return [...seen].map(([ticker, company]) => ({ ticker, company }));
  }

  /**
   * Top-k chunks by cosine similarity. With `queryText`, ranks by hybrid search instead:
   * vector and BM25 keyword rankings combined with reciprocal rank fusion.
   * The returned `score` is always the cosine similarity.
   */
  search(queryVector: ArrayLike<number>, k = 3, filter: SearchFilter = {}, queryText?: string): RetrievedChunk[] {
    if (queryVector.length !== this.index.dim) {
      throw new Error(`Query has dim ${queryVector.length}, index expects ${this.index.dim}`);
    }
    const q = normalize(queryVector);
    const allowed = filter.tickers?.length ? new Set(filter.tickers) : null;

    const scored: { i: number; score: number; keyword: number; rank: number }[] = [];
    this.index.chunks.forEach((chunk, i) => {
      if (allowed && !allowed.has(chunk.source.ticker)) return;
      if (filter.latestOnly && chunk.source.filedAt !== this.latestFiledAt.get(chunk.source.ticker)) return;
      scored.push({ i, score: dot(this.vectors[i], q), keyword: queryText ? this.bm25.score(queryText, i) : 0, rank: 0 });
    });

    scored.sort((a, b) => b.score - a.score);
    if (queryText) {
      const fused = new Map(scored.map((s, rank) => [s.i, 1 / (RRF_K + rank)]));
      // Only chunks that contain a query term earn a keyword-rank bonus.
      scored
        .filter((s) => s.keyword > 0)
        .sort((a, b) => b.keyword - a.keyword)
        .forEach((s, rank) => fused.set(s.i, fused.get(s.i)! + 1 / (RRF_K + rank)));
      for (const s of scored) s.rank = fused.get(s.i)!;
      scored.sort((a, b) => b.rank - a.rank);
    }

    // 10-Ks and 10-Qs repeat whole paragraphs (e.g. risk factors); skip near-duplicates so each slot adds something.
    const picked: { i: number; score: number }[] = [];
    for (const candidate of scored) {
      if (picked.length === k) break;
      const isDuplicate = picked.some((p) => dot(this.vectors[p.i], this.vectors[candidate.i]) > NEAR_DUPLICATE);
      if (!isDuplicate) picked.push(candidate);
    }

    return picked
      .map(({ i, score }) => {
        const { id, text, source } = this.index.chunks[i];
        return { id, text, source, score };
      });
  }
}

/**
 * Tickers from `companies` that the query refers to, by uppercase ticker ("NVDA")
 * or the first word of the company name ("nvidia", "Apple").
 */
export function mentionedTickers(
  query: string,
  companies: Pick<ChunkSource, "ticker" | "company">[],
): string[] {
  const lower = query.toLowerCase();
  return companies
    .filter(({ ticker, company }) => {
      if (new RegExp(`\\b${escape(ticker)}\\b`).test(query)) return true;
      const firstWord = company.split(/\s+/)[0]?.toLowerCase() ?? "";
      return firstWord.length >= 4 && new RegExp(`\\b${escape(firstWord)}\\b`).test(lower);
    })
    .map((c) => c.ticker);
}

/**
 * Removes company references the ticker filter already handles. Every chunk of NVIDIA's filings says
 * "NVIDIA", so leaving it in the query just pulls boilerplate (page headers, notes) toward the top.
 */
export function stripCompanyMentions(
  query: string,
  companies: Pick<ChunkSource, "ticker" | "company">[],
): string {
  let out = query;
  for (const { ticker, company } of companies) {
    const firstWord = company.split(/\s+/)[0] ?? "";
    for (const name of [ticker, firstWord].filter((n) => n.length >= 3)) {
      out = out.replace(new RegExp(`\\b${escape(name)}(['’]s)?\\b`, "gi"), " ");
    }
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length >= 3 ? out : query;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
