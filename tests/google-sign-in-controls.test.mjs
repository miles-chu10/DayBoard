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
        export const Field = ({ children }) => createElement("div", null, children);
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
                : `export const invoke = () => {}; export const errorMessage = () => "";`,
      }));
    },
  },
]);

for (const connected of [false, true]) {
  test(`a pending ${connected ? "reconnection" : "sign-in"} can be restarted without waiting for timeout`, () => {
    const html = renderToStaticMarkup(
      createElement(GoogleSettings, {
        status: { connected, hasCredentials: true, email: null, clientIdHint: null },
      }),
    );
    assert.match(html, /<button>Restart Google sign-in<\/button>/);
  });
}

test("unconfigured builds still disable Google sign-in", () => {
  const html = renderToStaticMarkup(
    createElement(GoogleSettings, {
      status: { connected: false, hasCredentials: false, email: null, clientIdHint: null },
    }),
  );
  assert.match(html, /<button disabled="">/);
});
