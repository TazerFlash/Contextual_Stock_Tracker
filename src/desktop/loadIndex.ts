import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MODELS, PATHS } from "../config";
import type { VectorIndex } from "../core/types";

// On disk: index.json holds metadata + chunk text, vectors.f32 the raw little-endian Float32 embeddings.

export async function saveIndex(index: VectorIndex): Promise<void> {
  const { vectors, ...meta } = index;
  await mkdir(dirname(PATHS.index), { recursive: true });
  await writeFile(PATHS.index, JSON.stringify(meta), "utf8");
  await writeFile(PATHS.vectors, new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength));
}

/** Loads the index, refusing one built with a different embedder (its vectors would be meaningless). */
export async function loadIndex(): Promise<VectorIndex> {
  let meta: Omit<VectorIndex, "vectors">;
  let bytes: Buffer;
  try {
    meta = JSON.parse(await readFile(PATHS.index, "utf8"));
    bytes = await readFile(PATHS.vectors);
  } catch {
    throw new Error(`No index at ${PATHS.index} + ${PATHS.vectors}. Run: npm run fetch, then npm run index`);
  }
  if (meta.embeddingModel !== MODELS.embed) {
    throw new Error(`Index was built with ${meta.embeddingModel}, but the configured embedder is ${MODELS.embed}. Run: npm run index`);
  }
  // Copy into an aligned buffer: Node may hand back a Buffer at an offset Float32Array can't view.
  const vectors = new Float32Array(new Uint8Array(bytes).buffer);
  return { ...meta, vectors };
}
