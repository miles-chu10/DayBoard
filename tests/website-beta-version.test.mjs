import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../website/${name}`, import.meta.url), "utf8");

// Verified against the downloaded release DMG, its GitHub digest and SHA256SUMS.txt.
const publishedDmg = {
  version: "1.3.0-beta.21",
  bytes: "138,344,080",
  sha256: "0d219fb8f72fdd29c532ecc9e73db18779e20deccc8a576098625b2d729c1ba4",
};

test("the site and installer pin the verified published release", async () => {
  const installer = await read("install.sh");
  assert.equal(installer.match(/^VERSION="([^"]+)"$/m)?.[1], publishedDmg.version);
  assert.equal(installer.match(/^DMG_SHA256="([^"]+)"$/m)?.[1], publishedDmg.sha256);
  assert.ok((await read("README.md")).includes(`The DMG is ${publishedDmg.bytes} bytes`));
});

// Each pattern marks copy that names the current beta, not a historical one such as a screenshot
// caption. All of them must name the beta whose DMG download.html links.
const currentBetaCopy = {
  "index.html": [
    /Beta (\d+) · Limited access/g,
    /Explore the beta (\d+) guide/g,
    /What's available in beta (\d+)/g,
    /DayBoard \d+\.\d+\.\d+ beta (\d+) for Apple silicon/g,
    /DayBoard \d+\.\d+\.\d+ beta (\d+) · [\d.]+ MB/g,
  ],
  "docs.html": [/Get started with DayBoard beta (\d+)/g, /make beta (\d+) work the way you do/g],
};

test("the homepage and guide name the beta the download page links", async () => {
  const download = await read("download.html");
  const linked = new Set(
    [...download.matchAll(/releases\/download\/v\d+\.\d+\.\d+-beta\.(\d+)\//g)].map((m) => m[1]),
  );
  assert.equal(linked.size, 1, "download.html links exactly one beta");
  const [beta] = linked;

  for (const [page, patterns] of Object.entries(currentBetaCopy)) {
    const html = await read(page);
    for (const pattern of patterns) {
      const found = [...html.matchAll(pattern)].map((m) => m[1]);
      assert.deepEqual(found, [beta], `${page} ${pattern} names beta ${beta}`);
    }
  }
});

// The homepage's download buttons and the Terminal installer fetch the DMG directly, so they must
// name the same file the download page links.
test("the homepage buttons and the installer fetch the DMG the download page links", async () => {
  const dmgLinks = (text) => [
    ...new Set(
      [
        ...text.matchAll(/releases\/download\/v(\d+\.\d+\.\d+-beta\.\d+)\/DayBoard-\1-arm64\.dmg/g),
      ].map((m) => m[1]),
    ),
  ];
  const linked = dmgLinks(await read("download.html"));
  assert.equal(linked.length, 1, "download.html links exactly one DMG");

  assert.deepEqual(dmgLinks(await read("index.html")), linked, "index.html download buttons");

  const installer = await read("install.sh");
  assert.equal(installer.match(/^VERSION="([^"]+)"$/m)?.[1], linked[0], "install.sh VERSION");

  const size = (await read("download.html")).match(/([\d.]+) MB disk image/)?.[1];
  assert.ok(size, "download.html states the DMG size");
  assert.match(await read("index.html"), new RegExp(`· ${size.replace(".", "\\.")} MB ·`));
});
