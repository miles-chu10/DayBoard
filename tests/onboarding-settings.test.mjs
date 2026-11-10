import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const platformStub = {
  name: "platform-stub",
  setup(build) {
    build.onResolve({ filter: /platform\/index\.js$/ }, (args) => ({
      path: args.path,
      namespace: "platform-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "platform-stub" }, () => ({
      contents:
        'export const app = { getPath: () => "/tmp" }; export const logger = { info() {}, warn() {}, error() {} }; export const safeStorage = {};',
      loader: "js",
    }));
  },
};

const { normalizeSettings, DEFAULT_SETTINGS } = await loadTs("main/services/settings-store.ts", [
  platformStub,
]);

test("only a new install starts with the first-run welcome still to show", () => {
  // No settings file: the defaults apply, so the welcome shows once.
  assert.equal(DEFAULT_SETTINGS.general.onboarded, false);
  // A settings file saved before the welcome existed counts as already onboarded.
  assert.equal(normalizeSettings({}).general.onboarded, true);
  assert.equal(normalizeSettings({ general: { theme: "dark" } }).general.onboarded, true);
  assert.equal(normalizeSettings({ general: { onboarded: "yes" } }).general.onboarded, true);
  // An explicit answer is kept either way.
  assert.equal(normalizeSettings({ general: { onboarded: false } }).general.onboarded, false);
  assert.equal(normalizeSettings({ general: { onboarded: true } }).general.onboarded, true);
});

test("Inbox rows default to one line and keep an explicit choice", () => {
  assert.equal(DEFAULT_SETTINGS.general.mailRows, "line");
  // Settings saved before the option existed get the one-line rows.
  assert.equal(normalizeSettings({}).general.mailRows, "line");
  assert.equal(normalizeSettings({ general: { mailRows: "dense" } }).general.mailRows, "line");
  assert.equal(normalizeSettings({ general: { mailRows: "preview" } }).general.mailRows, "preview");
});
