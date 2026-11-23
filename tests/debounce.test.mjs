import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const output = await build({
  entryPoints: [new URL("../shared/debounce.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { debounce } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
);

test("A burst of calls, such as 25 calendar switches, runs the work once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let runs = 0;
  const refresh = debounce(() => runs++, 600);
  for (let toggle = 0; toggle < 25; toggle++) {
    refresh();
    t.mock.timers.tick(200);
  }
  assert.equal(runs, 0);
  t.mock.timers.tick(600);
  assert.equal(runs, 1);
  refresh();
  t.mock.timers.tick(600);
  assert.equal(runs, 2);
});

test("A cancelled call never runs", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let runs = 0;
  const refresh = debounce(() => runs++, 600);
  refresh();
  refresh.cancel();
  t.mock.timers.tick(5_000);
  assert.equal(runs, 0);
});
