import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../website/${name}`, import.meta.url), "utf8");

// Verified against the downloaded release DMG, its GitHub digest and SHA256SUMS.txt.
const publishedDmg = {
  version: "1.3.7",
  bytes: "138,222,387",
  sha256: "035f30d3a71b985c81773ff44ff6b5d7a30427361a1c184abbe41eff44bb57da",
};

const dmgLinks = (text) => [
  ...new Set(
    [
      ...text.matchAll(
        /releases\/download\/v(\d+\.\d+\.\d+(?:-beta\.\d+)?)\/DayBoard-\1-arm64\.dmg/g,
      ),
    ].map((m) => m[1]),
  ),
];

test("the site and installer pin the verified published release", async () => {
  const installer = await read("install.sh");
  assert.equal(installer.match(/^VERSION="([^"]+)"$/m)?.[1], publishedDmg.version);
  assert.equal(installer.match(/^DMG_SHA256="([^"]+)"$/m)?.[1], publishedDmg.sha256);
  assert.ok((await read("README.md")).includes(`The DMG is ${publishedDmg.bytes} bytes`));
  assert.deepEqual(dmgLinks(await read("download.html")), [publishedDmg.version]);
});

// Each pattern marks copy that names the current release, not a historical one such as a
// screenshot caption. All of them must name the release whose DMG download.html links.
const currentVersionCopy = {
  "index.html": [
    /DayBoard (\d+\.\d+\.\d+) · (?:Limited access · )?Apple silicon/g,
    /What's available in DayBoard (\d+\.\d+\.\d+) and/g,
    /Shipped in DayBoard (\d+\.\d+\.\d+)\./g,
    /DayBoard (\d+\.\d+\.\d+) for Apple silicon/g,
    /DayBoard (\d+\.\d+\.\d+) · [\d.]+ MB/g,
  ],
  "docs.html": [/Get started with DayBoard (\d+\.\d+\.\d+):/g],
  "download.html": [
    /Download DayBoard (\d+\.\d+\.\d+) for Macs/g,
    /The latest version is DayBoard (\d+\.\d+\.\d+)\./g,
    /Version (\d+\.\d+\.\d+) · Apple silicon/g,
    /<h2 id="dl-title">DayBoard (\d+\.\d+\.\d+)<\/h2>/g,
    /releases\/tag\/v([^"]+)"/g,
    /releases\/download\/v([^/]+)\/SHA256SUMS\.txt/g,
  ],
};

test("the homepage, guide and download page name the release the download page links", async () => {
  const linked = dmgLinks(await read("download.html"));
  assert.equal(linked.length, 1, "download.html links exactly one DMG");
  const [version] = linked;

  for (const [page, patterns] of Object.entries(currentVersionCopy)) {
    const html = await read(page);
    for (const pattern of patterns) {
      const found = [...new Set([...html.matchAll(pattern)].map((m) => m[1]))];
      assert.deepEqual(found, [version], `${page} ${pattern} names ${version}`);
    }
  }
});

// The homepage's download buttons and the Terminal installer fetch the DMG directly, so they must
// name the same file the download page links.
test("the homepage buttons and the installer fetch the DMG the download page links", async () => {
  const linked = dmgLinks(await read("download.html"));
  assert.equal(linked.length, 1, "download.html links exactly one DMG");

  assert.deepEqual(dmgLinks(await read("index.html")), linked, "index.html download buttons");

  const installer = await read("install.sh");
  assert.equal(installer.match(/^VERSION="([^"]+)"$/m)?.[1], linked[0], "install.sh VERSION");

  const size = (await read("download.html")).match(/([\d.]+) MB disk image/)?.[1];
  assert.ok(size, "download.html states the DMG size");
  assert.match(await read("index.html"), new RegExp(`· ${size.replace(".", "\\.")} MB ·`));
});
