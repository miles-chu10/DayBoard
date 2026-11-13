import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
const { createCoalescedSaveQueue } = await loadTs("main/services/coalesced-save-queue.ts");
test("stream snapshots coalesce but every caller waits for durable acknowledgment", async () => {
  const writes = [];
  const q = createCoalescedSaveQueue(async (value) => {
    writes.push(value);
    return value;
  }, 5);
  const results = await Promise.all([q.save("a", 1), q.save("a", 2), q.save("a", 3)]);
  assert.deepEqual(writes, [3]);
  assert.deepEqual(results, [3, 3, 3]);
});
test("reads and other chat/account keys are barriers, including after failures", async () => {
  const seen = [];
  const q = createCoalescedSaveQueue(async (value) => {
    seen.push(value);
    if (value === "bad") throw Error("disk");
    return value;
  }, 1);
  const jobs = [
    q.save("a", "first"),
    q.run(async () => seen.push("read")),
    q.save("a", "second"),
    q.save("b", "bad").catch(() => {}),
    q.save("a", "last"),
  ];
  await Promise.all(jobs);
  assert.deepEqual(seen, ["first", "read", "second", "bad", "last"]);
});
