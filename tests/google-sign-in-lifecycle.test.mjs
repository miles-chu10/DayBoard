import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTs } from "./helpers/load-ts.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "dayboard-sign-in-"));
  const state = { dir, tokens: null, writes: [], authorize: async () => ({ accessToken: "new" }) };
  globalThis.__signInFixture = state;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ email: "fixture@example.com" });
  t.after(async () => {
    globalThis.fetch = realFetch;
    delete globalThis.__signInFixture;
    await rm(dir, { recursive: true, force: true });
  });
  const auth = await loadTs("main/services/google-auth.ts", [
    {
      name: "sign-in-fixture",
      setup(build) {
        build.onResolve(
          { filter: /(platform\/index|google-oauth-app-client|google-loopback-oauth)\.js$/ },
          (args) => ({ path: args.path, namespace: "fixture" }),
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "js",
          contents: args.path.includes("platform")
            ? `
          const state = globalThis.__signInFixture;
          export const app = { getPath: () => state.dir };
          export const logger = { warn() {} };
          export class OAuthRefreshRejectedError extends Error {}
          export class OAuthTokenStateChangedError extends Error {}
          export class OAuthService {
            async getTokens() { return state.tokens; }
            async setTokens(tokens) { state.tokens = tokens; state.writes.push(tokens); }
            async removeTokens() { state.tokens = null; }
          }`
            : args.path.includes("app-client")
              ? `
          export const GOOGLE_APP_CLIENT_ID = "fixture.apps.googleusercontent.com";
          export const GOOGLE_APP_CLIENT_SECRET = "fixture";`
              : `
          export async function authorizeGoogleWithLoopback(options) {
            return globalThis.__signInFixture.authorize(options);
          }`,
        }));
      },
    },
  ]);
  return { state, auth };
}

test("sign-out aborts a browser wait and late tokens cannot reconnect", async (t) => {
  const { state, auth } = await fixture(t);
  const browser = deferred();
  let signal;
  state.authorize = async (options) => {
    signal = options.signal;
    return browser.promise;
  };
  const pending = auth.authorizeGoogle();
  await auth.disconnectGoogle();
  assert.equal(signal.aborted, true);
  browser.resolve({ accessToken: "late" });
  await assert.rejects(pending, /cancelled/);
  assert.equal(state.tokens, null);
  assert.deepEqual(state.writes, []);
});

test("sign-out invalidates tokens already returned while the handler waits for saves", async (t) => {
  const { state, auth } = await fixture(t);
  const authorization = await auth.authorizeGoogle();
  await auth.disconnectGoogle();
  await assert.rejects(auth.completeGoogleSignIn(authorization), /cancelled/);
  assert.equal(state.tokens, null);
  assert.deepEqual(state.writes, []);
});

test("a newer attempt invalidates an authorized attempt before commit", async (t) => {
  const { state, auth } = await fixture(t);
  const old = await auth.authorizeGoogle();
  const current = await auth.authorizeGoogle();
  await assert.rejects(auth.completeGoogleSignIn(old), /replaced/);
  await auth.completeGoogleSignIn(current);
  assert.equal(state.writes.length, 1);
  await assert.rejects(auth.completeGoogleSignIn(current), /replaced/);
});

test("replacement during profile lookup cannot commit the old account", async (t) => {
  const { state, auth } = await fixture(t);
  const profile = deferred();
  globalThis.fetch = async () => profile.promise;
  const old = await auth.authorizeGoogle();
  const completing = auth.completeGoogleSignIn(old);
  const current = await auth.authorizeGoogle();
  profile.resolve(Response.json({ email: "old@example.com" }));
  await assert.rejects(completing, /replaced/);
  assert.deepEqual(state.writes, []);
  globalThis.fetch = async () => Response.json({ email: "new@example.com" });
  await auth.completeGoogleSignIn(current);
  assert.equal((await auth.getGoogleStatus()).email, "new@example.com");
});
