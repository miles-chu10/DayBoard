import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: [new URL("../renderer/lib/shell.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { fitColumns, inspectorWidth, separatorKey } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("details fit the 440px content minimum without overwriting remembered widths", () => {
  assert.equal(inspectorWidth(559, 280), null);
  assert.equal(inspectorWidth(681, 280), 240);
  assert.equal(inspectorWidth(721, 280), 280);
  assert.equal(inspectorWidth(859, 380), 380);
  assert.equal(inspectorWidth(800, 280), 280);
  assert.equal(inspectorWidth(859, 10000), 380);
});
test("splitter keys resize in 8/32px steps and clamp to pane bounds", () => {
  assert.equal(separatorKey("ArrowRight", false, 240, 180, 400), 248);
  assert.equal(separatorKey("ArrowLeft", true, 240, 180, 400), 208);
  assert.equal(separatorKey("ArrowRight", false, 280, 240, 380, -1), 272);
  assert.equal(separatorKey("Home", false, 280, 240, 380, -1), 240);
  assert.equal(separatorKey("End", false, 280, 240, 380, -1), 380);
  assert.equal(separatorKey("ArrowLeft", true, 375, 240, 380, -1), 380);
  assert.equal(separatorKey("Escape", false, 280, 240, 380), null);
});

test("the sidebar, content and right pane always fit the window", () => {
  const sidebar = { width: 220, min: 180, max: 400 };
  const pane = { width: 360, min: 300, max: 560 };
  // Plenty of room: everything keeps its remembered width.
  assert.deepEqual(fitColumns(1280, 440, sidebar, pane), {
    sidebar: 220,
    sidebarMax: 400,
    inspector: 360,
  });
  // Tighter: the pane and then the sidebar narrow, and the content keeps 440.
  const tight = fitColumns(960, 440, sidebar, pane);
  assert.deepEqual(tight, { sidebar: 180, sidebarMax: 180, inspector: 338 });
  assert.ok(tight.sidebar + tight.inspector + 2 + 440 <= 960);
  // At the 800px minimum window the sidebar steps aside instead of pushing content off screen.
  const narrow = fitColumns(800, 440, sidebar, pane);
  assert.deepEqual(narrow, { sidebar: null, sidebarMax: 0, inspector: 359 });
  // Without the pane the sidebar behaves as before.
  assert.deepEqual(fitColumns(800, 440, sidebar, null), {
    sidebar: 220,
    sidebarMax: 359,
    inspector: null,
  });
});
