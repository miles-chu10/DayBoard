import { createSerialQueue, readJsonFile, writeFileAtomic } from "./file-store.js";

/** A small JSON file, read once and then changed one update at a time. */
export function createJsonStore<T>(options: {
  path: () => string;
  /** Turns whatever is on disk (null when missing or damaged) into a valid value. */
  parse: (value: unknown) => T;
  /** A file that wasn't JSON was kept as `copy` and the store started over. */
  onDamaged?: (copy: string, error: unknown) => void;
}) {
  const queue = createSerialQueue();
  let cache: { path: string; value: T } | null = null;

  async function load(): Promise<T> {
    const target = options.path();
    if (cache?.path === target) return cache.value;
    // A read that fails throws here and caches nothing, so no update can overwrite the file.
    const value = options.parse(await readJsonFile(target, options.onDamaged));
    cache = { path: target, value };
    return value;
  }

  return {
    read: () => queue(load),
    update: (change: (value: T) => T) =>
      queue(async () => {
        const next = change(await load());
        const target = options.path();
        await writeFileAtomic(target, JSON.stringify(next));
        cache = { path: target, value: next };
        return next;
      }),
  };
}
