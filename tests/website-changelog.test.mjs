import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const bundle = await build({
  entryPoints: [path.join(root, "scripts/changelog.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { buildChangelogPage, formatDate } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const read = (file) => readFileSync(path.join(root, file), "utf8");
const { releases } = JSON.parse(read("docs/changelog.json"));

test("the committed changelog page matches its release notes (run npm run changelog)", () => {
  const page = buildChangelogPage({
    shell: read("website/download.html"),
    releases,
    readNotes: (version) => read(`docs/release-notes-${version}.md`),
  });
  assert.equal(read("website/changelog.html"), page);
});

test("changelog releases are newest first, dated, and have notes and images", () => {
  const dates = releases.map((release) => release.date);
  assert.deepEqual([...dates].sort().reverse(), dates);
  for (const release of releases) {
    assert.ok(existsSync(path.join(root, `docs/release-notes-${release.version}.md`)));
    for (const image of release.image ? [release.image.light, release.image.dark] : [])
      assert.ok(existsSync(path.join(root, "website", image)), image);
  }
  assert.equal(formatDate("2026-11-11"), "November 11, 2026");
});

test("the changelog page has a beta badge per beta and links to each GitHub release", () => {
  const html = read("website/changelog.html");
  const betas = releases.filter((r) => r.version.includes("-")).length;
  assert.equal(html.match(/class="release-badge">Beta</g)?.length, betas);
  for (const { version } of releases) {
    assert.match(html, new RegExp(`id="v${version.replaceAll(".", "\\.")}"`));
    assert.match(html, new RegExp(`releases/tag/v${version.replaceAll(".", "\\.")}"`));
  }
  assert.doesNotMatch(html, /Before publishing|Release verification|after he approves/);
  assert.match(html, /<link rel="canonical" href="https:\/\/getdayboard.com\/changelog"/);
});
