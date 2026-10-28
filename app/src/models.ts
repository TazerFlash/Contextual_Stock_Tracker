import { DocumentDirectoryPath, downloadFile, exists, mkdir, stat, unlink } from '@dr.pogodin/react-native-fs';
import { CHAT_MODELS, EMBED_MODEL, type ModelFile } from '../../src/core/models';

// Models live in the app's private internal storage (/data/user/0/com.stocktracker/files/models).
// Not the external Android/data folder: files `adb push`ed there belong to the shell user, and Android
// hides them from the app. For development, copy models in with `adb shell run-as` (debug builds only).
export const MODELS_DIR = `${DocumentDirectoryPath}/models`;

export const REQUIRED_MODELS: { label: string; file: ModelFile }[] = [
  { label: 'Chat model (Qwen2.5-0.5B)', file: CHAT_MODELS['0.5b'] },
  { label: 'Search model (bge-small)', file: EMBED_MODEL },
];

export const modelPath = (file: ModelFile) => `${MODELS_DIR}/${file.fileName}`;

/** A model counts as present only if the file is complete (a cut-off download is smaller). */
export async function isPresent(file: ModelFile): Promise<boolean> {
  const path = modelPath(file);
  return (await exists(path)) && Number((await stat(path)).size) === file.bytes;
}

export async function missingModels(): Promise<ModelFile[]> {
  const missing = [];
  for (const { file } of REQUIRED_MODELS) if (!(await isPresent(file))) missing.push(file);
  return missing;
}

/**
 * One-time download from Hugging Face: the only network use in the app. Afterwards everything
 * (search and generation) runs offline. `onProgress` receives overall bytes done / total.
 */
export async function downloadModels(onProgress: (done: number, total: number) => void): Promise<void> {
  await mkdir(MODELS_DIR);
  const missing = await missingModels();
  const total = missing.reduce((sum, f) => sum + f.bytes, 0);
  let finished = 0;
  for (const file of missing) {
    const path = modelPath(file);
    if (await exists(path)) await unlink(path); // drop a partial file from an interrupted download
    const { promise } = downloadFile({
      fromUrl: file.url,
      toFile: path,
      progressInterval: 250,
      progress: ({ bytesWritten }) => onProgress(finished + bytesWritten, total),
    });
    const { statusCode } = await promise;
    if (statusCode !== 200) throw new Error(`Download failed (${statusCode}): ${file.fileName}`);
    finished += file.bytes;
    onProgress(finished, total);
  }
}
