import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

// The sign-in page is never opened: the stub records the URL the browser would have loaded.
const opened = [];
globalThis.__loopbackOpened = opened;
const stubs = {
  name: "loopback-stubs",
  setup(build) {
    build.onResolve({ filter: /platform\/index\.js$/ }, (args) => ({
      path: args.path,
      namespace: "loopback-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "loopback-stub" }, () => ({
      contents: `export const shell = {
        openExternal: async (url) => void globalThis.__loopbackOpened.push(url),
      };`,
      loader: "js",
    }));
  },
};
const { authorizeGoogleWithLoopback } = await loadTs("main/services/google-loopback-oauth.ts", [
  stubs,
]);

const options = (signal) => ({
  clientId: "fixture.apps.googleusercontent.com",
  clientSecret: "fixture",
  scopes: ["openid"],
  extraParameters: {},
  signal,
});

async function redirectOf(index) {
  while (opened.length <= index) await new Promise((resolve) => setImmediate(resolve));
  return new URL(opened[index]).searchParams.get("redirect_uri");
}

test("starting sign-in again stops waiting on the abandoned browser tab", async () => {
  const attempt = new AbortController();
  const waiting = authorizeGoogleWithLoopback(options(attempt.signal));
  const redirect = await redirectOf(opened.length);
  attempt.abort();
  await assert.rejects(waiting, /started again/);
  // Its one-shot redirect listener is gone, so the old tab can't complete a sign-in later.
  await assert.rejects(fetch(redirect));
});

test("a sign-in that was already replaced never opens the browser wait", async () => {
  const attempt = new AbortController();
  attempt.abort();
  const before = opened.length;
  await assert.rejects(authorizeGoogleWithLoopback(options(attempt.signal)), /started again/);
  assert.equal(opened.length, before);
});
