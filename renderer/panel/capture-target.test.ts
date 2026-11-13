import assert from "node:assert/strict";
import test from "node:test";

import { chooseTarget, targetOptions } from "./capture-target";

const tasks = [
  { id: "work", title: "Work" },
  { id: "home", title: "Home" },
];
const reminders = [{ id: "groceries", title: "Groceries" }];

test("lists AI first while AI capture is on, then task lists, then Reminders lists", () => {
  const options = targetOptions({ ai: true, tasks, reminders });
  assert.deepEqual(
    options.map((option) => [option.key, option.group]),
    [
      ["auto", null],
      ["task:work", "Google Tasks"],
      ["task:home", "Google Tasks"],
      ["reminder:groceries", "Reminders"],
    ],
  );
  assert.deepEqual(options[3].target, { kind: "reminder", listId: "groceries" });
});

test("without AI there is no automatic choice, and missing sources add nothing", () => {
  const options = targetOptions({ ai: false, tasks: null, reminders });
  assert.deepEqual(
    options.map((option) => option.key),
    ["reminder:groceries"],
  );
  assert.deepEqual(targetOptions({ ai: false, tasks: null, reminders: null }), []);
});

test("keeps a saved list while it exists and falls back to the first option otherwise", () => {
  const options = targetOptions({ ai: true, tasks, reminders });
  assert.equal(chooseTarget(options, "task:home")?.title, "Home");
  assert.equal(chooseTarget(options, "task:deleted")?.key, "auto");
  assert.equal(chooseTarget(options, null)?.key, "auto");
  const manual = targetOptions({ ai: false, tasks, reminders });
  assert.equal(chooseTarget(manual, "auto")?.key, "task:work");
  assert.equal(chooseTarget([], "task:work"), null);
});
