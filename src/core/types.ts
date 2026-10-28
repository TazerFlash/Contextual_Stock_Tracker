// Platform-agnostic types shared by the desktop engine today and the React Native app later.

/** Layer 2: small, structured user state (kept under ~1,000 tokens). */
export interface SharedMemory {
  userId: string;
  watchlist: string[];
  targetPrices: Record<string, number>;
  portfolioNotes: string;
  recentSentiment: Record<string, string>;
  /** One-sentence takeaways written back by the memory loop (FR-04). */
  insights: Insight[];
}

export interface Insight {
  text: string;
  createdAt: string;
}

export interface ChunkSource {
  ticker: string;
  company: string;
  form: string;
  filedAt: string;
  url: string;
}

/** Layer 1: one chunk of a filing. Its embedding lives in VectorIndex.vectors at row `id`. */
export interface IndexedChunk {
  id: number;
  text: string;
  source: ChunkSource;
}

export interface VectorIndex {
  embeddingModel: string;
  dim: number;
  createdAt: string;
  chunks: IndexedChunk[];
  /**
   * All embeddings in one flat buffer (chunks.length × dim, row-major). Stored on disk as a raw
   * Float32 file: ~4x smaller in memory than JSON number arrays, and loads without parsing.
   */
  vectors: Float32Array;
}

export interface RetrievedChunk {
  id: number;
  text: string;
  source: ChunkSource;
  score: number;
}

export interface Prompt {
  system: string;
  user: string;
}

export interface GenerateOptions {
  maxTokens: number;
  temperature: number;
  stop: string[];
  /** Penalty on recently generated tokens (1 = off); stops small models from looping. */
  repeatPenalty?: number;
  onToken?: (text: string) => void;
}

/** The only thing that differs between desktop (node-llama-cpp) and mobile (llama.rn). */
export interface LlmEngine {
  /** Some embedders (e.g. bge) encode search queries differently from the passages they search. */
  embed(text: string, kind?: "query" | "passage"): Promise<number[]>;
  generate(prompt: Prompt, options: GenerateOptions): Promise<string>;
}

/** Same shape as React Native AsyncStorage, so it can be passed in directly. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
