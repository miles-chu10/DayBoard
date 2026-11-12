import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
async function load(entry) {
  const bundle = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
}
const notesModule = await load("shared/release-notes.ts");
const { createReleaseNotesReader } = await load("main/services/release-notes.ts");
const { parseReleaseNotes, displayVersion, sectionTitle, isReleaseVersion, releaseNotesUrl } =
  notesModule;
const { releases } = JSON.parse(readFileSync(path.join(root, "docs/changelog.json"), "utf8"));

test("versions display the way the release names them", () => {
  assert.equal(displayVersion("1.3.0"), "1.3.0");
  assert.equal(displayVersion("1.3.0-beta.22"), "1.3.0 beta 22");
  assert.ok(isReleaseVersion("1.3.0-beta.22"));
  for (const bad of ["v1.3.0", "1.3", "../x", "1.3.0/../../x", 3])
    assert.ok(!isReleaseVersion(bad));
  assert.equal(
    releaseNotesUrl("1.3.1"),
    "https://raw.githubusercontent.com/miles-chu10/dayboard/v1.3.1/docs/release-notes-1.3.1.md",
  );
});

test("headings, lists, bold, code and links parse into sections", () => {
  const notes = parseReleaseNotes(
    "1.4.0",
    [
      "# DayBoard 1.4.0 — Faster mail",
      "",
      "Intro with **bold**",
      "over two lines.",
      "",
      "## New",
      "",
      "- **Thing.** Uses `code` and a [link](https://getdayboard.com/x).",
      "  Continues here.",
      "- Second.",
      "",
      "## Fixes",
      "",
      "- A fix.",
      "",
      "## Before publishing",
      "",
      "- Push the tag after approval.",
    ].join("\n"),
  );
  assert.equal(notes.subtitle, "Faster mail");
  assert.equal(notes.summary.length, 1);
  assert.deepEqual(notes.summary[0], [
    { kind: "text", text: "Intro with " },
    { kind: "strong", text: "bold" },
    { kind: "text", text: " over two lines." },
  ]);
  assert.deepEqual(
    notes.sections.map((s) => [s.kind, sectionTitle(s), s.items.length]),
    [
      ["new", "New features", 2],
      ["fixed", "Bug fixes", 1],
    ],
  );
  assert.deepEqual(notes.sections[0].items[0], [
    { kind: "strong", text: "Thing." },
    { kind: "text", text: " Uses " },
    { kind: "code", text: "code" },
    { kind: "text", text: " and a " },
    { kind: "link", text: "link", href: "https://getdayboard.com/x" },
    { kind: "text", text: ". Continues here." },
  ]);
});

test("every published release has notes with user-facing sections only", () => {
  for (const { version } of releases) {
    const notes = parseReleaseNotes(
      version,
      readFileSync(path.join(root, `docs/release-notes-${version}.md`), "utf8"),
    );
    assert.ok(notes.sections.length > 0, version);
    for (const section of notes.sections) {
      assert.doesNotMatch(section.title, /publish|verification|under the hood/i, version);
      for (const item of [...section.items, ...section.paragraphs])
        assert.doesNotMatch(
          item.map((part) => part.text).join(""),
          /Miles|after he approves/,
          `${version} ${section.title}`,
        );
    }
  }
});

test("the reader fetches the tag's notes once and treats failures as missing", async () => {
  const urls = [];
  let mode = "ok";
  const read = createReleaseNotesReader({
    fetch: async (url) => {
      urls.push(url);
      if (mode === "throw") throw new Error("offline");
      if (mode === "404") return new Response("nope", { status: 404 });
      return new Response("# DayBoard 9.0.0\n\n## Fixed\n\n- One.\n");
    },
  });
  mode = "404";
  assert.equal(await read("8.0.0"), null);
  mode = "throw";
  assert.equal(await read("8.0.1"), null);
  mode = "ok";
  const notes = await read("9.0.0");
  assert.equal(notes.sections[0].kind, "fixed");
  assert.equal(await read("9.0.0"), notes);
  assert.equal(urls.filter((url) => url.includes("/v9.0.0/")).length, 1);
  await assert.rejects(read("../../etc"), /Invalid DayBoard version/);
});
