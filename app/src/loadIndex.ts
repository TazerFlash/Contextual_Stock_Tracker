import { readFileAssets } from '@dr.pogodin/react-native-fs';
import { EMBED_MODEL } from '../../src/core/models';
import type { VectorIndex } from '../../src/core/types';

// The index ships inside the APK (android/app/src/main/assets/index/), copied there by
// `npm run sync-index` from the desktop pipeline's data/index/.

/** Loads the bundled index; refuses one built with a different embedder (its vectors would be meaningless). */
export async function loadIndex(): Promise<VectorIndex> {
  const meta = JSON.parse(await readFileAssets('index/index.json', 'utf8')) as Omit<VectorIndex, 'vectors'>;
  if (meta.embeddingModel !== EMBED_MODEL.uri) {
    throw new Error(`Bundled index was built with ${meta.embeddingModel}, expected ${EMBED_MODEL.uri}. Rebuild it and run npm run sync-index.`);
  }
  const vectors = new Float32Array(base64ToBytes(await readFileAssets('index/vectors.f32', 'base64')).buffer);
  if (vectors.length !== meta.chunks.length * meta.dim) {
    throw new Error(`vectors.f32 holds ${vectors.length} floats, expected ${meta.chunks.length} × ${meta.dim}`);
  }
  return { ...meta, vectors };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
