import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryHistory } from "@tanstack/history";
import { loadTs } from "./helpers/load-ts.mjs";

const { navigateHistory, registerNavigationGuard } = await loadTs(
  "renderer/lib/navigation-guard.ts",
);

for (const direction of ["back", "forward"]) {
  test(`Notes history ${direction} stays on the editor after failure and leaves after retry`, async () => {
    const history = createMemoryHistory({
      initialEntries: ["/tasks", "/notes", "/calendar"],
      initialIndex: 1,
    });
    let saved = false;
    const unregister = registerNavigationGuard(history, async () => saved);
    await navigateHistory(history, direction);
    assert.equal(history.location.href, "/notes");
    saved = true;
    await navigateHistory(history, direction);
    assert.equal(history.location.href, direction === "back" ? "/tasks" : "/calendar");
    unregister();
    history.destroy();
  });
}

test("a guard removed during save cannot trigger stale navigation", async () => {
  const history = createMemoryHistory({ initialEntries: ["/tasks", "/notes"] });
  const saving = Promise.withResolvers();
  const unregister = registerNavigationGuard(history, () => saving.promise);
  const leaving = navigateHistory(history, "back");
  unregister();
  saving.resolve(true);
  await leaving;
  assert.equal(history.location.href, "/notes");
  await navigateHistory(history, "back");
  assert.equal(history.location.href, "/tasks");
  history.destroy();
});

test("repeated history commands waiting for a save move only once", async () => {
  const history = createMemoryHistory({ initialEntries: ["/", "/tasks", "/notes"] });
  const saving = Promise.withResolvers();
  const unregister = registerNavigationGuard(history, () => saving.promise);
  const first = navigateHistory(history, "back");
  const latest = navigateHistory(history, "back");
  saving.resolve(true);
  await Promise.all([first, latest]);
  assert.equal(history.location.href, "/tasks");
  unregister();
  history.destroy();
});
