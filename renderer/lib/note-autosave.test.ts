import assert from "node:assert/strict";
import test from "node:test";

import { createNoteAutosave, type NoteSaveState } from "./note-autosave";

function harness(id?: string) {
  const saves: { id?: string; title: string; body: string }[] = [];
  const states: NoteSaveState[] = [];
  const fixture = { fail: false };
  const autosave = createNoteAutosave({
    id,
    persist: async (note) => {
      saves.push(note);
      if (fixture.fail) throw new Error("Synthetic save failure");
      return { id: note.id ?? "created" };
    },
    onState: (state) => states.push(state),
    delay: 60_000,
  });
  return { autosave, saves, states, fixture };
}

test("a new note is created once and later saves update it", async () => {
  const { autosave, saves, states } = harness();
  autosave.change({ title: "", body: "first" });
  autosave.change({ title: "", body: "first draft" });
  await autosave.flush();
  autosave.change({ title: "Plan", body: "first draft" });
  await autosave.flush();
  assert.deepEqual(saves, [
    { title: "", body: "first draft" },
    { id: "created", title: "Plan", body: "first draft" },
  ]);
  assert.equal(states.at(-1), "saved");
});

test("an untouched or empty new note is never saved", async () => {
  const { autosave, saves } = harness();
  await autosave.flush();
  autosave.change({ title: " ", body: "" });
  await autosave.flush();
  assert.deepEqual(saves, []);
});

test("a failed save keeps the text so the next save retries it", async () => {
  const { autosave, saves, states, fixture } = harness("note-1");
  fixture.fail = true;
  autosave.change({ title: "Plan", body: "an hour of typing" });
  assert.equal(await autosave.flush(), false);
  assert.equal(states.at(-1), "unsaved");

  // ⌘S, Back and leaving Notes all flush again without another keystroke.
  fixture.fail = false;
  assert.equal(await autosave.flush(), true);
  assert.deepEqual(saves.at(-1), { id: "note-1", title: "Plan", body: "an hour of typing" });
  assert.equal(states.at(-1), "saved");
});

test("a retry never overwrites newer typing with the failed draft", async () => {
  const { autosave, saves, fixture } = harness("note-1");
  fixture.fail = true;
  autosave.change({ title: "", body: "old" });
  const failing = autosave.flush();
  autosave.change({ title: "", body: "old and new" });
  await failing;
  fixture.fail = false;
  assert.equal(await autosave.flush(), true);
  assert.deepEqual(saves.at(-1), { id: "note-1", title: "", body: "old and new" });
});

test("deleting drops unsaved edits and reports the note to delete", async () => {
  const { autosave, saves } = harness("note-1");
  autosave.change({ title: "", body: "discard me" });
  assert.equal(await autosave.discard(), "note-1");
  await autosave.flush();
  assert.deepEqual(saves, []);
});

test("deleting during a save that fails does not bring the note back", async () => {
  const { autosave, saves, fixture } = harness();
  fixture.fail = true;
  autosave.change({ title: "", body: "deleted before it saved" });
  const failing = autosave.flush();
  await Promise.resolve();
  assert.equal(saves.length, 1);
  assert.equal(await autosave.discard(), undefined);
  await failing;
  fixture.fail = false;
  // Closing the editor flushes once more; nothing is left to save.
  assert.equal(await autosave.flush(), true);
  assert.equal(saves.length, 1);
});
