// Model files shared by the desktop engine and the phone app. The phone must embed queries with the
// same model the index was built with, so both sides read the definitions from here.

export interface ModelFile {
  /** node-llama-cpp URI (also stored in the index as `embeddingModel`). */
  uri: string;
  /** Direct download URL. */
  url: string;
  fileName: string;
  bytes: number;
}

function huggingFace(repo: string, fileName: string, bytes: number): ModelFile {
  return {
    uri: `hf:${repo}/${fileName}`,
    url: `https://huggingface.co/${repo}/resolve/main/${fileName}`,
    fileName,
    bytes,
  };
}

/** Instruction-tuned Qwen2.5 chat models (the old base Qwen1.5 did not follow the answer format). */
export const CHAT_MODELS = {
  "0.5b": huggingFace("Qwen/Qwen2.5-0.5B-Instruct-GGUF", "qwen2.5-0.5b-instruct-q4_k_m.gguf", 491_400_032),
  "1.5b": huggingFace("Qwen/Qwen2.5-1.5B-Instruct-GGUF", "qwen2.5-1.5b-instruct-q4_k_m.gguf", 1_117_320_736),
};

/**
 * bge-small-en-v1.5 (384-d, ~37 MB). Trained for question → passage search; replaced all-MiniLM-L6-v2,
 * which ranked boilerplate above answers.
 */
export const EMBED_MODEL = {
  ...huggingFace("CompendiumLabs/bge-small-en-v1.5-gguf", "bge-small-en-v1.5-q8_0.gguf", 36_806_944),
  /** bge expects this instruction on queries (not on passages). */
  queryPrefix: "Represent this sentence for searching relevant passages: ",
};

/** Bounded CPU threads (NFR-03) and context size, shared so desktop numbers match the phone's settings. */
export const RUNTIME = {
  threads: 4,
  /** Prompts are ~500 tokens (3 chunks + focused profile) + 200 output; 2048 fits with headroom and saves RAM. */
  contextSize: 2048,
};
