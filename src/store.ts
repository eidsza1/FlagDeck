import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Flag } from "./flags.js";

/**
 * File-backed store for feature flags. Flags are kept in memory and persisted
 * to a JSON file on every mutation. Reads are served from memory.
 */
export class FlagStore {
  private flags = new Map<string, Flag>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as { flags: Flag[] };
      for (const flag of data.flags ?? []) {
        this.flags.set(flag.key, flag);
      }
    } catch (err: unknown) {
      // A missing file just means an empty store on first run.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const data = { flags: [...this.flags.values()] };
    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  async list(): Promise<Flag[]> {
    await this.ensureLoaded();
    return [...this.flags.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async get(key: string): Promise<Flag | undefined> {
    await this.ensureLoaded();
    return this.flags.get(key);
  }

  async has(key: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.flags.has(key);
  }

  async upsert(flag: Flag): Promise<void> {
    await this.ensureLoaded();
    this.flags.set(flag.key, flag);
    await this.persist();
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureLoaded();
    const existed = this.flags.delete(key);
    if (existed) await this.persist();
    return existed;
  }
}
