import { DocumentDirectoryPath, exists, readFile, writeFile } from '@dr.pogodin/react-native-fs';
import type { KeyValueStorage } from '../../src/core/types';

/** AsyncStorage-shaped store backed by one JSON file per key in the app's private documents folder. */
export class FsStorage implements KeyValueStorage {
  async getItem(key: string): Promise<string | null> {
    const path = this.path(key);
    return (await exists(path)) ? readFile(path, 'utf8') : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await writeFile(this.path(key), value, 'utf8');
  }

  private path(key: string): string {
    return `${DocumentDirectoryPath}/${key}.json`;
  }
}
