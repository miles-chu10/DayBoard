import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryHistory } from "@tanstack/history";
import { loadTs } from "./helpers/load-ts.mjs";

// Exercise the editor's real navigation hook and autosave with synthetic persistence and UI.
const fixture = { blocker: null, fail: true, saves: [] };
globalThis.__notesNavigation = fixture;
// TanStack skips client-side blockers when no document exists (server rendering).
globalThis.document = {};
const stubs = {
  react: `export const useState = (value) => [typeof value === 'function' ? value() : value, () => {}]; export const useEffect = () => {};`,
  "react/jsx-runtime": `export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = 'Fragment';`,
  "@tanstack/react-router": `export const useBlocker = (options) => { globalThis.__notesNavigation.blocker = options; }; export const useRouter = () => ({ history: {} }); export const useNavigate = () => () => {}; export const useSearch = () => ({ note: 'new' });`,
  "@renderer/ui": `export const AlertDialog = 'AlertDialog', Button = 'Button', EmptyState = 'EmptyState', Input = 'Input', Markdown = 'Markdown', ScrollArea = 'ScrollArea', Status = 'Status', Text = 'Text', Textarea = 'Textarea';`,
  "lucide-react": `export const ChevronLeft = 'ChevronLeft', Eye = 'Eye', NotebookPen = 'NotebookPen', PencilLine = 'PencilLine', Plus = 'Plus', Trash2 = 'Trash2';`,
  "../components/history-nav": `export const HistoryNav = 'HistoryNav';`,
  "../components/shell": `export const usePublishViewContext = () => {};`,
  "../components/view-actions": `export const WindowActions = 'WindowActions';`,
  "../lib/ipc": `export const errorMessage = String;`,
  "../lib/agent-data": `
    export const useNotes = () => ({ data: [] });
    export const useNoteActions = () => ({
      save: { mutateAsync: async (note) => {
        const fixture = globalThis.__notesNavigation;
        fixture.saves.push(note);
        if (fixture.fail) throw new Error('Synthetic persistent failure');
        return { id: 'created' };
      } }, remove: { mutateAsync: async () => {} }
    });`,
};
const { NotesView } = await loadTs("renderer/main/notes-view.tsx", [
  {
    name: "notes-navigation-fixture",
    setup(api) {
      api.initialOptions.jsx = "automatic";
      api.onResolve({ filter: /.*/ }, ({ path }) =>
        Object.hasOwn(stubs, path) ? { path, namespace: "stub" } : undefined,
      );
      api.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({
        contents: stubs[path],
        loader: "js",
      }));
    },
  },
]);

function find(element, type) {
  if (!element || typeof element !== "object") return undefined;
  if (element.type === type) return element;
  for (const child of [element.props?.children].flat()) {
    const match = find(child, type);
    if (match) return match;
  }
}

for (const destination of ["/tasks", "/notes?note=other"]) {
  test(`failed Notes save blocks navigation to ${destination} and retries without losing text`, async () => {
    fixture.fail = true;
    fixture.saves = [];
    const editor = NotesView();
    const rendered = editor.type(editor.props);
    const input = find(rendered, "Textarea");
    input.props.onChange({ target: { value: "Keep these unsaved notes" } });
    assert.equal(fixture.blocker.enableBeforeUnload(), true);

    const history = createMemoryHistory({ initialEntries: ["/notes"] });
    const unblock = history.block({ blockerFn: fixture.blocker.shouldBlockFn });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        history.push(destination);
        await new Promise(setImmediate);
        assert.equal(history.location.href, "/notes");
        assert.equal(fixture.blocker.enableBeforeUnload(), true);
      }
      fixture.fail = false;
      history.push(destination);
      await new Promise(setImmediate);
      assert.equal(history.location.href, destination);
      assert.equal(fixture.blocker.enableBeforeUnload(), false);
      assert.equal(fixture.saves.length, 3);
      assert.ok(fixture.saves.every((save) => save.body === "Keep these unsaved notes"));
    } finally {
      unblock();
      // Ensure the test never leaves a debounce timer running, including on assertion failure.
      fixture.fail = false;
      await fixture.blocker.shouldBlockFn();
      history.destroy();
    }
  });
}
