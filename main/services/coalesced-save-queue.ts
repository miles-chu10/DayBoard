import { createSerialQueue } from "./file-store.js";

/** Coalesce only adjacent saves of the same record. Reads/selections are ordering barriers. */
export function createCoalescedSaveQueue<T, R>(write: (value: T) => Promise<R>, delayMs = 150) {
  const queue = createSerialQueue();
  let pending: { key: string; value: T; result: Promise<R> } | undefined;
  return {
    save(key: string, value: T): Promise<R> {
      if (pending?.key === key) {
        pending.value = value;
        return pending.result;
      }
      const batch = { key, value, result: undefined as unknown as Promise<R> };
      // Start the window on submission, not after older disk writes finish.
      const window = new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      batch.result = queue(async () => {
        await window;
        if (pending === batch) pending = undefined;
        return write(batch.value);
      });
      pending = batch;
      return batch.result;
    },
    run<U>(operation: () => Promise<U>): Promise<U> {
      pending = undefined;
      return queue(operation);
    },
  };
}
