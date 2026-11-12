import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTs } from "./helpers/load-ts.mjs";

const require = createRequire(import.meta.url);
const { GoogleSettings } = await loadTs("renderer/settings/account-settings.tsx", [
  {
    name: "sign-in-controls",
    setup(build) {
      build.initialOptions.jsx = "automatic";
      build.onResolve({ filter: /^react(\/.*)?$/ }, (args) => ({
        path: pathToFileURL(require.resolve(args.path)).href,
        external: true,
      }));
      build.onResolve(
        { filter: /^(?:@tanstack\/react-query|@renderer\/ui)$|\/lib\/(queries|ipc)$/ },
        (args) => ({ path: args.path, namespace: "fixture" }),
      );
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        loader: "js",
        contents:
          args.path === "@renderer/ui"
            ? `
        import { createElement } from "react";
        export const Button = ({ children, disabled }) => createElement("button", { disabled }, children);
        export const Field = ({ children, description }) => createElement("div", null, description, children);
        export const cn = (...names) => names.filter(Boolean).join(" ");
        const Hidden = () => null;
        export const AlertDialog = Hidden;
        export const AlertDialogCancel = Hidden;
        export const AlertDialogContent = Hidden;
        export const AlertDialogDescription = Hidden;
        export const AlertDialogFooter = Hidden;
        export const AlertDialogHeader = Hidden;
        export const AlertDialogTitle = Hidden;
        export const FieldSet = Field;
        export const Status = Field;
        export const toast = { success() {}, error() {} };`
            : args.path.includes("react-query")
              ? `
        export const useQueryClient = () => ({});
        export const useMutation = () => ({ isPending: false });`
              : args.path.endsWith("queries")
                ? `
        export const useConnectGoogle = () => ({ isPending: true, mutate() {} });
        export const useRequestRemindersAccess = () => ({});
        export const queryKeys = {};`
                : `export const invoke = () => {}; export const errorMessage = () => ""; export const openExternal = () => {};`,
      }));
    },
  },
]);

const status = (overrides) => ({
  connected: false,
  hasCredentials: true,
  email: null,
  clientIdHint: null,
  missingAccess: [],
  ...overrides,
});
const render = (overrides) =>
  renderToStaticMarkup(createElement(GoogleSettings, { status: status(overrides) }));

test("a pending reconnection can be restarted without waiting for timeout", () => {
  assert.match(render({ connected: true }), /<button>Restart Google sign-in<\/button>/);
});

test("a pending sign-in can be restarted from the Google-branded button", () => {
  const html = render({});
  assert.match(html, /<span class="whitespace-nowrap">Sign in with Google<\/span>/);
  assert.match(html, /Waiting for your browser\. Click to start again\./);
});

test("unconfigured builds still disable Google sign-in", () => {
  assert.match(render({ hasCredentials: false }), /<button type="button"[^>]* disabled="">/);
});

test("names the Google permissions the user didn't grant", () => {
  const html = render({ connected: true, missingAccess: ["mail", "calendar"] });
  assert.match(
    html,
    /Gmail and Google Calendar are off because DayBoard wasn’t given permission\. Sign in again and tick them/,
  );
  assert.doesNotMatch(render({ connected: true }), /wasn’t given permission/);
});
