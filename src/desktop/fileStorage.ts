import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KeyValueStorage } from "../core/types";

/** AsyncStorage stand-in for desktop: one JSON file per key. */
export class FileStorage implements KeyValueStorage {
  constructor(private readonly dir: string) {}

  async getItem(key: string): Promise<string | null> {
    try {
      return await readFile(this.path(key), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(key), value, "utf8");
  }

  path(key: string): string {
    return join(this.dir, `${key}.json`);
  }
}
