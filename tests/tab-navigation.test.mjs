import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryHistory } from "@tanstack/history";
import { loadTs } from "./helpers/load-ts.mjs";

const { createTabNavigation, registerNavigationGuard } = await loadTs(
  "tests/fixtures/tab-navigation.ts",
);
const { selectTab, closeTab, openTab } = await loadTs("renderer/lib/tabs.ts");
globalThis.document = {};
const tick = () => new Promise(setImmediate);
const initial = () => ({
  tabs: [
    { id: "notes", route: "/notes", search: { note: "new" } },
    { id: "tasks", route: "/tasks", search: {} },
    { id: "home", route: "/", search: {} },
  ],
  active: "notes",
});
function fixture(t) {
  const history = createMemoryHistory({ initialEntries: ["/notes?note=new"] });
  let state = initial();
  const commits = [];
  const navigation = createTabNavigation({
    history,
    commit(next) {
      state = next;
      commits.push(next);
    },
    async navigate(route, search, state) {
      const query = new URLSearchParams(search).toString();
      history.push(route + (query ? `?${query}` : ""), state);
      // Like TanStack, resolution alone does not prove navigation passed its blockers.
    },
  });
  const unsubscribe = navigation.subscribe();
  t.after(() => {
    unsubscribe();
    history.destroy();
  });
  return { history, navigation, commits, state: () => state, unsubscribe };
}

for (const [name, propose] of [
  ["switch", (state) => selectTab(state, "tasks")],
  ["close active", (state) => closeTab(state, "notes")],
  ["open", (state) => openTab(state, { id: "new", route: "/", search: {} })],
]) {
  test(`blocked tab ${name} retains the Notes tab and selection until a successful retry`, async (t) => {
    const f = fixture(t);
    let fail = true;
    registerNavigationGuard(f.history, async () => !fail);
    f.navigation.show(propose(f.state()));
    await tick();
    assert.deepEqual(f.state(), initial());
    assert.deepEqual(f.commits, []);
    assert.equal(f.history.location.pathname, "/notes");
    fail = false;
    const next = propose(f.state());
    f.navigation.show(next);
    await tick();
    assert.deepEqual(f.state(), next);
    assert.equal(f.commits.length, 1);
  });
}

test("newer tab command wins when an older blocked navigation finishes late", async (t) => {
  const f = fixture(t);
  const pending = [];
  registerNavigationGuard(f.history, () => new Promise((resolve) => pending.push(resolve)));
  f.navigation.show(selectTab(f.state(), "tasks"));
  f.navigation.show(selectTab(f.state(), "home"));
  pending[1](true);
  await tick();
  pending[0](true);
  await tick();
  assert.equal(f.state().active, "home");
  assert.equal(f.history.location.pathname, "/");
  assert.equal(f.commits.length, 1);
});

test("an older save result cannot consume a newer pending tab proposal", async (t) => {
  const f = fixture(t);
  const pending = [];
  registerNavigationGuard(f.history, () => new Promise((resolve) => pending.push(resolve)));
  f.navigation.show(selectTab(f.state(), "tasks"));
  f.navigation.show(selectTab(f.state(), "home"));
  pending[0](true);
  await tick();
  assert.deepEqual(f.commits, []);
  pending[1](true);
  await tick();
  assert.equal(f.state().active, "home");
  assert.equal(f.history.location.pathname, "/");
  assert.equal(f.commits.length, 1);
});

test("external navigation invalidates a pending tab proposal", async (t) => {
  const f = fixture(t);
  let release;
  registerNavigationGuard(
    f.history,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  f.navigation.show(closeTab(f.state(), "notes"));
  f.history.push("/mail", {}, { ignoreBlocker: true });
  release(true);
  await tick();
  assert.deepEqual(f.state(), initial());
  assert.equal(f.history.location.pathname, "/mail");
  assert.deepEqual(f.commits, []);
});

test("closing an inactive tab cannot be undone by a pending tab switch", async (t) => {
  const f = fixture(t);
  let release;
  registerNavigationGuard(
    f.history,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  f.navigation.show(selectTab(f.state(), "tasks"));
  f.navigation.commit(closeTab(f.state(), "home"));
  release(true);
  await tick();
  assert.deepEqual(
    f.state().tabs.map((tab) => tab.id),
    ["notes", "tasks"],
  );
  assert.equal(f.state().active, "notes");
  assert.equal(f.history.location.pathname, "/notes");
});

test("unmount cancels pending tab state changes", async (t) => {
  const f = fixture(t);
  let release;
  registerNavigationGuard(
    f.history,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  f.navigation.show(closeTab(f.state(), "notes"));
  f.unsubscribe();
  release(true);
  await tick();
  assert.deepEqual(f.commits, []);
  assert.equal(f.history.location.pathname, "/notes");
});

test("same-route tab changes commit through their distinct history state", async (t) => {
  const f = fixture(t);
  const next = openTab(f.state(), { id: "other-notes", route: "/notes", search: { note: "new" } });
  f.navigation.show(next);
  await tick();
  assert.equal(f.state().active, "other-notes");
  assert.equal(f.commits.length, 1);
});
