import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function readFileIfExists(target: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Reads a JSON file: null when it doesn't exist. A file that isn't valid JSON is copied beside
 * itself as `<name>.damaged-<time>` before it reads as missing, and any other read failure
 * throws, so a caller can never replace data it could not read.
 */
export async function readJsonFile(
  target: string,
  onDamaged?: (copy: string, error: unknown) => void,
): Promise<unknown> {
  const raw = await readFileIfExists(target);
  if (!raw) return null;
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch (error) {
    const copy = `${target}.damaged-${Date.now()}`;
    await fs.copyFile(target, copy, fs.constants.COPYFILE_EXCL);
    onDamaged?.(copy, error);
    return null;
  }
}

export async function writeFileAtomic(target: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, target);
  } finally {
    // `rename` removes the temporary file on success. Clean up a failed write without
    // touching the last committed target.
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Copies `source` to `target` but never replaces an existing `target`. False if `source` is missing. */
export async function copyFileIfPresent(source: string, target: string): Promise<boolean> {
  try {
    await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Moves `source` to `target` but never replaces an existing `target`. False if `source` is missing. */
export async function moveFileIfPresent(source: string, target: string): Promise<boolean> {
  if (!(await copyFileIfPresent(source, target))) return false;
  await fs.rm(source, { force: true });
  return true;
}

/** Runs async operations one at a time so concurrent saves never interleave. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.then(operation, operation);
    tail = run.catch(() => undefined);
    return run;
  };
  enqueue.drain = () => tail.then(() => undefined);
  return enqueue;
}
