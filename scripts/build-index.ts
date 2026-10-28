// Chunks every filing in the manifest, embeds each chunk, writes data/index/index.json + vectors.f32.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { INGEST, MODELS, PATHS } from "../src/config";
import { chunkText } from "../src/core/chunker";
import type { ChunkSource } from "../src/core/types";
import { createIndex } from "../src/core/vectorStore";
import { saveIndex } from "../src/desktop/loadIndex";
import { NodeLlamaEngine } from "../src/desktop/nodeLlamaEngine";
import type { ManifestEntry } from "./fetch-filings";

const manifest = JSON.parse(await readFile(PATHS.manifest, "utf8")) as ManifestEntry[];
const engine = await NodeLlamaEngine.create();

const items: { text: string; source: ChunkSource; vector: number[] }[] = [];
const started = performance.now();
for (const entry of manifest) {
  const text = await readFile(join(PATHS.corpus, entry.file), "utf8");
  const pieces = chunkText(text, { chunkSize: INGEST.chunkSize, chunkOverlap: INGEST.chunkOverlap }).filter(
    (p) => p.length >= INGEST.minChunkChars,
  );
  const { file, chars, cik, ...source } = entry;
  for (const [i, piece] of pieces.entries()) {
    items.push({ text: piece, source, vector: await engine.embed(piece) });
    if (i % 50 === 0) process.stdout.write(`\r${file}: ${i + 1}/${pieces.length}   `);
  }
  console.log(`\r${file}: ${pieces.length} chunks          `);
}

const index = createIndex({ embeddingModel: MODELS.embed, createdAt: new Date().toISOString() }, items);
await saveIndex(index);
await engine.dispose();
console.log(`\n${index.chunks.length} chunks (dim ${index.dim}) in ${((performance.now() - started) / 1000).toFixed(1)}s -> ${PATHS.index} + ${PATHS.vectors}`);
