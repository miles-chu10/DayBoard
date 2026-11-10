import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryHistory } from "@tanstack/history";
import { loadTs } from "./helpers/load-ts.mjs";

const fixture = { history: null, state: null, cleanup: [] };
globalThis.__tabProvider = fixture;
globalThis.document = {};
globalThis.window = {
  dayboard: { ipc: { onNotification: () => () => {} } },
  addEventListener() {},
  removeEventListener() {},
};
const stubs = {
  react: `
    export const createContext = () => ({ Provider: 'Provider' });
    export const useContext = () => {};
    export const useMemo = (fn) => fn();
    export const useCallback = (fn) => fn;
    export const useEffect = (fn) => { const cleanup = fn(); if (cleanup) globalThis.__tabProvider.cleanup.push(cleanup); };
    export const useState = (initial) => {
      let value = typeof initial === 'function' ? initial() : initial;
      if (value?.tabs) globalThis.__tabProvider.state = value;
      return [value, (next) => {
        value = typeof next === 'function' ? next(value) : next;
        if (value?.tabs) globalThis.__tabProvider.state = value;
      }];
    };`,
  "react/jsx-runtime": `export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;`,
  "@tanstack/react-router": `
    const navigate = async ({ to, search, state, ignoreBlocker }) => {
      const query = new URLSearchParams(search).toString();
      globalThis.__tabProvider.history.push(to + (query ? '?' + query : ''), state, { ignoreBlocker });
    };
    export const useNavigate = () => navigate;
    export const useRouter = () => ({ history: globalThis.__tabProvider.history, navigate });
    export const useRouterState = () => ({ pathname: '/notes', search: { note: 'new' } });`,
  "@renderer/ui": `export const useOptionalSplitView = () => null;`,
  "@renderer/ui/utils": `export const cn = () => '';`,
  "lucide-react": `export const Plus = 'Plus', X = 'X';`,
  "../lib/ipc": `export const invoke = async () => {};`,
  "../lib/navigation": `export const NAV_ITEMS = [{ route: '/notes' }, { route: '/tasks' }, { route: '/' }];`,
  "../lib/storage": `export const readStored = () => ({ tabs: [{ id: 'notes', route: '/notes', search: { note: 'new' } }, { id: 'tasks', route: '/tasks', search: {} }], active: 'notes' }); export const writeStored = () => {};`,
};
const { TabsProvider, registerNavigationGuard } = await loadTs("tests/fixtures/tab-provider.ts", [
  {
    name: "tab-provider-fixture",
    setup(api) {
      api.initialOptions.jsx = "automatic";
      api.onResolve({ filter: /.*/ }, ({ path }) =>
        Object.hasOwn(stubs, path) ? { path, namespace: "fixture" } : undefined,
      );
      api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        contents: stubs[path],
        loader: "js",
      }));
    },
  },
]);

for (const action of ["select", "close", "open"]) {
  test(`TabsProvider ${action} waits for successful Notes navigation before changing tab state`, async (t) => {
    fixture.history = createMemoryHistory({ initialEntries: ["/notes?note=new"] });
    fixture.cleanup = [];
    t.after(() => {
      fixture.cleanup.forEach((fn) => fn());
      fixture.history.destroy();
    });
    let fail = true;
    fixture.history.block({ blockerFn: async () => fail });
    fixture.cleanup.push(registerNavigationGuard(fixture.history, async () => !fail));
    const value = TabsProvider({ children: null }).props.value;
    const before = fixture.state;
    const act = () => value[action](action === "select" ? "tasks" : "notes");
    act();
    await new Promise(setImmediate);
    assert.deepEqual(fixture.state, before);
    fail = false;
    act();
    await new Promise(setImmediate);
    assert.notEqual(fixture.state.active, "notes");
  });
}
