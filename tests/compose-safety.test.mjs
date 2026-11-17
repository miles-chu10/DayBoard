import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

async function fixture(initialDraft = null) {
  globalThis.React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  };
  const state = { values: [], invokes: [], toasts: [], initialDraft, hook: 0, scope: "google:a" };
  globalThis.__composeSafety = state;
  const stubs = {
    react: `export const createContext = () => ({Provider: 'Provider'});
      export const useContext = x => x; export const useEffect = () => {};
      export const useRef = current => ({current});
      export const useState = initial => [globalThis.__composeSafety.hook++ === 0 ? globalThis.__composeSafety.initialDraft : initial, value => globalThis.__composeSafety.values.push(value)];`,
    "react/jsx-runtime": `export const jsx=(type,props)=>({type,props}); export const jsxs=jsx;`,
    "@renderer/ui": `export const Dialog='Dialog', Field='Field', FieldGroup='FieldGroup', Input='Input', Text='Text', Textarea='Textarea';
      export const toast=(...args)=>{globalThis.__composeSafety.toasts.push(args);return 1}; toast.success=toast; toast.error=toast;`,
    "@tanstack/react-query": `export const useQueryClient = () => ({ getQueryData: () => globalThis.__composeSafety.scope });`,
    "../lib/queries": `export const queryKeys = { agendaScope: ["agenda", "scope"] };`,
    "../lib/ipc": `export const errorMessage=e=>e.message; export const invoke=(...args)=>{globalThis.__composeSafety.invokes.push(args);return new Promise(()=>{})};`,
  };
  const mod = await loadTs("renderer/components/compose-dialog.tsx", [
    {
      name: "compose-fixture",
      setup(api) {
        api.onResolve({ filter: /.*/ }, (args) =>
          stubs[args.path] ? { path: args.path, namespace: "fixture" } : undefined,
        );
        api.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    },
  ]);
  return { state, mod };
}

test("restoring an older mail cannot replace the active compose draft", async () => {
  const { state, mod } = await fixture();
  const view = mod.ComposeProvider({ children: null });
  const { openCompose } = view.props.value;
  openCompose({ body: "current" });
  openCompose({ body: "restored old mail" }, { recovered: true });
  assert.equal(state.values.filter((x) => x?.body).length, 1);
  assert.equal(state.values.find((x) => x?.body).body, "current");
  assert.match(state.toasts.at(-1)[0], /^Draft recovered\. Finish the current email/);
  // An ordinary New Email while one is open is not a recovered draft and must not say so.
  openCompose();
  assert.equal(state.values.filter((x) => x?.body).length, 1);
  assert.equal(state.toasts.at(-1)[0], "Finish or close the current email first.");
  openCompose({ to: "a@example.com", body: "second" });
  assert.equal(state.toasts.at(-1)[0], "Finish the current email to open the next one.");
});

test("repeated Send and Cmd-Enter share a synchronous in-flight lock", async () => {
  const { state, mod } = await fixture({
    to: "a@example.com",
    cc: "",
    subject: "hello",
    body: "one email",
  });
  const provider = mod.ComposeProvider({ children: null });
  const dialogElement = provider.props.children[1];
  const dialog = dialogElement.type(dialogElement.props);
  void dialog.props.onConfirm();
  void dialog.props.onConfirm();
  assert.equal(state.invokes.length, 1);
  assert.equal(state.invokes[0][0], "mail:send");
});

test("a draft is not sent from an account it wasn't written in", async () => {
  const draft = { to: "a@example.com", cc: "", subject: "hello", body: "one email" };
  const { state, mod } = await fixture({ ...draft, scope: "google:a" });
  const provider = mod.ComposeProvider({ children: null });
  const dialogElement = provider.props.children[1];
  // The Google account is switched while the draft is open.
  state.scope = "google:b";
  const dialog = dialogElement.type(dialogElement.props);
  await dialog.props.onConfirm();
  assert.equal(state.invokes.length, 0);
  assert.ok(state.values.some((value) => /account changed while you were writing/.test(value)));
  // The draft now names the new account, so a second, deliberate Send goes from it.
  const retarget = state.values.find((value) => typeof value === "function");
  assert.equal(retarget(dialogElement.props.initial).scope, "google:b");

  // A reply belongs to the account that received the message and is never retargeted.
  const reply = await fixture({ ...draft, replyToId: "m1", scope: "google:a" });
  const replyProvider = reply.mod.ComposeProvider({ children: null });
  const replyElement = replyProvider.props.children[1];
  reply.state.scope = "google:b";
  await replyElement.type(replyElement.props).props.onConfirm();
  assert.equal(reply.state.invokes.length, 0);
  assert.ok(reply.state.values.some((value) => /different Google account/.test(value)));
});

test("a send names the account the draft was written in", async () => {
  const { state, mod } = await fixture({
    to: "a@example.com",
    cc: "",
    subject: "hello",
    body: "one email",
    scope: "google:a",
  });
  const provider = mod.ComposeProvider({ children: null });
  const dialogElement = provider.props.children[1];
  void dialogElement.type(dialogElement.props).props.onConfirm();
  assert.equal(state.invokes[0][1].expectedScope, "google:a");
});
