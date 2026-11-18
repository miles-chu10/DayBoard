import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PREFS, normalizePrefs } from "./panel-prefs";

test("panel preferences fall back to their defaults field by field", () => {
  assert.deepEqual(normalizePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs("nope"), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs({ mail: false, completed: true, tasks: "no", extra: 1 }), {
    ...DEFAULT_PREFS,
    mail: false,
    completed: true,
  });
});
