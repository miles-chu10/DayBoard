import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const bundle = await build({
  entryPoints: [path.join(root, "main/services/update-prompt.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { createUpdatePrompt } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function fixture({ phase = "idle", availableVersion = null, preferences = {} } = {}) {
  const calls = [];
  const shown = [];
  let open = false;
  let state = { phase, availableVersion, currentVersion: "1.3.0", message: "", error: null };
  let prefs = { automaticDownload: false, skippedVersion: null, ...preferences };
  const prompt = createUpdatePrompt({
    updates: {
      status: () => state,
      check: async () => {
        calls.push("check");
        return state;
      },
      download: async () => {
        calls.push("download");
        return state;
      },
      install: async () => {
        calls.push("install");
        return state;
      },
    },
    preferences: {
      read: async () => prefs,
      update: async (change) => (prefs = change(prefs)),
    },
    window: {
      show: (value) => {
        open = true;
        shown.push(value);
      },
      close: () => {
        open = false;
        calls.push("close");
      },
      isOpen: () => open,
    },
  });
  return {
    prompt,
    calls,
    shown,
    set state(next) {
      state = { ...state, ...next };
    },
    get prefs() {
      return prefs;
    },
    closeWindow() {
      open = false;
      prompt.closed();
    },
  };
}

test("a background check offers a new version once per launch instead of downloading", async () => {
  const item = fixture({ phase: "available", availableVersion: "1.3.1" });
  assert.equal(await item.prompt.shouldDownloadAutomatically("1.3.1"), false);
  assert.deepEqual(
    item.shown.map((s) => [s.mode, s.version]),
    [["prompt", "1.3.1"]],
  );
  item.closeWindow();
  assert.equal(await item.prompt.shouldDownloadAutomatically("1.3.1"), false);
  assert.equal(item.shown.length, 1);
  assert.equal(await item.prompt.shouldDownloadAutomatically("1.3.2"), false);
  assert.equal(item.shown.at(-1).version, "1.3.2");
});

test("a skipped version is never offered by background checks", async () => {
  const item = fixture({ phase: "available", availableVersion: "1.3.1" });
  await item.prompt.skip("1.3.1");
  assert.equal(item.prefs.skippedVersion, "1.3.1");
  assert.ok(item.calls.includes("close"));
  const fresh = fixture({
    phase: "available",
    availableVersion: "1.3.1",
    preferences: { skippedVersion: "1.3.1" },
  });
  assert.equal(await fresh.prompt.shouldDownloadAutomatically("1.3.1"), false);
  assert.equal(fresh.shown.length, 0);
});

test("a downloaded update can't be skipped because it installs on quit", async () => {
  const item = fixture({ phase: "downloaded", availableVersion: "1.3.1" });
  await assert.rejects(item.prompt.skip("1.3.1"), /already downloaded/);
  await assert.rejects(item.prompt.skip("9.9.9"), /no longer offered/);
});

test("automatic download downloads silently, then offers the ready update", async () => {
  const item = fixture({ preferences: { automaticDownload: true } });
  assert.equal(await item.prompt.shouldDownloadAutomatically("1.3.1"), true);
  assert.equal(item.shown.length, 0);
  item.prompt.onStateChange({ phase: "downloaded", availableVersion: "1.3.1" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(
    item.shown.map((s) => [s.mode, s.version]),
    [["prompt", "1.3.1"]],
  );
});

test("Install on Quit downloads in the background and closes the window", async () => {
  const item = fixture({ phase: "available", availableVersion: "1.3.1" });
  await item.prompt.installOnQuit();
  assert.deepEqual(item.calls, ["close", "download"]);
});

test("Install and Relaunch shows progress, then downloads or installs", async () => {
  const available = fixture({ phase: "available", availableVersion: "1.3.1" });
  await available.prompt.installNow();
  assert.equal(available.shown.at(-1).mode, "progress");
  assert.deepEqual(available.calls, ["download"]);
  const ready = fixture({ phase: "downloaded", availableVersion: "1.3.1" });
  await ready.prompt.installNow();
  assert.deepEqual(ready.calls, ["install"]);
});

test("Check for Updates shows progress and switches to the offer when one is found", async () => {
  const item = fixture();
  await item.prompt.checkNow();
  assert.equal(item.shown[0].mode, "progress");
  assert.deepEqual(item.calls, ["check"]);
  item.prompt.onStateChange({ phase: "available", availableVersion: "1.3.1" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual([item.shown.at(-1).mode, item.shown.at(-1).version], ["prompt", "1.3.1"]);
  const known = fixture({ phase: "available", availableVersion: "1.3.1" });
  await known.prompt.checkNow();
  assert.equal(known.shown[0].mode, "prompt");
  assert.deepEqual(known.calls, []);
});

test("settings are validated", async () => {
  const item = fixture();
  await assert.rejects(item.prompt.setAutomaticDownload("yes"), /Invalid/);
  assert.equal((await item.prompt.setAutomaticDownload(true)).automaticDownload, true);
});
