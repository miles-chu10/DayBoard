import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../website/assets/site.js", import.meta.url), "utf8");

// Runs the real site script with a given buyUrl against stand-ins for the buy button and the
// "checkout isn't open yet" note, and returns them after the script ran.
function run(buyUrl) {
  assert.equal(source.match(/buyUrl: "[^"]*"/g)?.length, 1);
  const script = source.replace(/buyUrl: "[^"]*"/, `buyUrl: ${JSON.stringify(buyUrl)}`);
  const button = { hidden: true, href: undefined, dataset: { buy: "pricing" } };
  const untagged = { hidden: true, href: undefined, dataset: { buy: "" } };
  const note = { hidden: false };
  const lists = { "a[data-buy]": [button, untagged], "[data-buy-pending]": [note] };
  vm.runInNewContext(script, {
    document: {
      querySelector: () => null,
      querySelectorAll: (selector) => lists[selector] ?? [],
    },
    window: { scrollY: 0, addEventListener() {} },
    location: { hostname: "getdayboard.com" },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    URL,
  });
  return { button, untagged, note };
}

test("the shipped site points its buy buttons at the live checkout page", () => {
  assert.match(source, /buyUrl: "https:\/\/api\.getdayboard\.com\/buy"/);
});

test("an empty checkout address keeps the buy button hidden and says checkout isn't open", () => {
  const { button, note } = run("");
  assert.equal(button.hidden, true);
  assert.equal(button.href, undefined);
  assert.equal(note.hidden, false);
});

test("an HTTPS checkout address shows the buy button, keeps its tag and hides the note", () => {
  const { button, untagged, note } = run("https://api.getdayboard.com/buy");
  assert.equal(button.hidden, false);
  assert.equal(button.href, "https://api.getdayboard.com/buy?from=pricing");
  assert.equal(untagged.href, "https://api.getdayboard.com/buy");
  assert.equal(note.hidden, true);
});

test("a non-HTTPS or malformed checkout address keeps the button hidden", () => {
  for (const url of ["http://api.getdayboard.com/buy", "javascript:alert(1)", "not a url"]) {
    const { button, note } = run(url);
    assert.equal(button.hidden, true, url);
    assert.equal(note.hidden, false, url);
  }
});

test("the pricing page links to checkout in its HTML, so buying works without scripts", async () => {
  const page = await readFile(new URL("../website/pricing.html", import.meta.url), "utf8");
  const address = source.match(/buyUrl: "([^"]*)"/)[1];
  assert.match(
    page,
    new RegExp(`<a class="button" data-buy="pricing" href="${address}\\?from=pricing"`),
  );
  assert.match(page, /<p data-buy-pending hidden>/);
});

test("the download page offers DayBoard Pro beside the download, in its HTML", async () => {
  const page = await readFile(new URL("../website/download.html", import.meta.url), "utf8");
  const address = source.match(/buyUrl: "([^"]*)"/)[1];
  const buyLinks = [
    ...page.matchAll(/<a\s+class="button[^"]*"\s+data-buy="([^"]*)"\s+href="([^"]*)"/g),
  ];
  assert.deepEqual(
    buyLinks.map(([, tag]) => tag),
    ["download-started", "download-page"],
    "the download-started note and the Pro offer",
  );
  for (const [, tag, href] of buyLinks) assert.equal(href, `${address}?from=${tag}`);
  assert.match(page, /<p class="fine" data-buy-pending hidden>/);
  assert.match(page, /<a\s+class="button"\s+data-download\s+href="[^"]+\.dmg"/);
  assert.match(page, /<div class="download-started" data-download-started role="status" hidden>/);
});

test("every site buy link names where it sits, and its HTML link carries that tag", async () => {
  const address = source.match(/buyUrl: "([^"]*)"/)[1];
  const tags = new Set();
  for (const name of ["index.html", "download.html", "pricing.html"]) {
    const page = await readFile(new URL(`../website/${name}`, import.meta.url), "utf8");
    const links = [...page.matchAll(/<a\b[^>]*\bdata-buy\b[^>]*>/g)].map(([tag]) => tag);
    assert.ok(links.length > 0, name);
    for (const link of links) {
      const [, tag, href] = link.match(/data-buy="([a-z0-9-]{1,32})"\s+href="([^"]*)"/) ?? [];
      assert.ok(tag, `${name}: ${link}`);
      assert.equal(href, `${address}?from=${tag}`, name);
      tags.add(tag);
    }
  }
  assert.deepEqual([...tags].sort(), [
    "download-page",
    "download-started",
    "home-download-started",
    "pricing",
  ]);
});
