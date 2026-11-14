import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [new URL("../main/platform/window-policy.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { windowEntryUrl, isAllowedWindowNavigation, isExternalWebUrl, mainWindowCloseAction } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );

test("privileged local windows accept only their exact document and hash routes", () => {
  const entry = windowEntryUrl("main-window.html", "/fixture/renderer");
  assert.equal(isAllowedWindowNavigation(entry, entry), true);
  assert.equal(isAllowedWindowNavigation(`${entry}#/mail`, entry), true);
  for (const target of [
    "file:///fixture/renderer/settings-window.html",
    "file:///fixture/private.html",
    `${entry}?remote=https://example.com`,
    "https://example.com/main-window.html",
    "javascript:alert(1)",
  ])
    assert.equal(isAllowedWindowNavigation(target, entry), false, target);
});

test("development navigation rejects origin and path prefix lookalikes", () => {
  const entry = windowEntryUrl("main-window.html", "/fixture", "http://localhost:5173/");
  assert.equal(isAllowedWindowNavigation(entry, entry), true);
  for (const target of [
    "http://localhost:51730/main-window.html",
    "http://localhost:5173/main-window.html.evil",
    "http://localhost:5173/other.html",
    "http://localhost.evil.test:5173/main-window.html",
  ])
    assert.equal(isAllowedWindowNavigation(target, entry), false, target);
  for (const origin of ["https://example.com", "http://user@localhost:5173", "file:///tmp/"])
    assert.throws(() => windowEntryUrl("main-window.html", "/fixture", origin));
  assert.throws(() => windowEntryUrl("../private.html", "/fixture"));
});

test("external link policy excludes executable schemes and embedded credentials", () => {
  assert.equal(isExternalWebUrl("https://example.com/help"), true);
  for (const url of [
    "file:///tmp/x",
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "not a url",
  ])
    assert.equal(isExternalWebUrl(url), false, url);
});

test("closing the dashboard on macOS keeps it loaded unless the app is quitting", () => {
  const open = { platform: "darwin", keepLoaded: true, fullScreen: false };
  assert.equal(mainWindowCloseAction(open), "hide");
  // A hidden full-screen window would leave an empty Space behind.
  assert.equal(mainWindowCloseAction({ ...open, fullScreen: true }), "leave-full-screen");
  // Quit and update install close every window first; holding one open would cancel them.
  assert.equal(mainWindowCloseAction({ ...open, keepLoaded: false }), "close");
  assert.equal(mainWindowCloseAction({ ...open, keepLoaded: false, fullScreen: true }), "close");
  // Elsewhere the last window closing is what quits the app.
  assert.equal(mainWindowCloseAction({ ...open, platform: "linux" }), "close");
});
