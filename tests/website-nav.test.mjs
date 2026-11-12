import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const dir = new URL("../website/", import.meta.url);
const pages = readdirSync(dir).filter((name) => name.endsWith(".html"));

// Normalizes each page's own link prefix ("#x", "index.html#x" or "/index.html#x") so the menus compare equal.
function menuItems(html) {
  return [
    ...html.matchAll(/<a class="nav-item"[^>]*href="([^"]+)"[\s\S]*?class="nav-title">([^<]+)</g),
  ].map(
    ([, href, title]) =>
      `${title.trim()} -> ${href.replace(/^\/?(index\.html)?(?=#)/, "").replace(/^\//, "")}`,
  );
}

test("every page has the same Product and Resources menus", () => {
  const reference = menuItems(readFileSync(new URL("index.html", dir), "utf8"));
  assert.equal(reference.length, 15);
  for (const page of pages) {
    const html = readFileSync(new URL(page, dir), "utf8");
    assert.deepEqual(menuItems(html), reference, page);
    for (const id of ["nav-product", "nav-resources"]) {
      assert.match(html, new RegExp(`aria-controls="${id}"`), `${page} ${id} trigger`);
      assert.match(html, new RegExp(`id="${id}"`), `${page} ${id} panel`);
    }
  }
});

test("menu links point at sections that exist on the homepage", () => {
  const home = readFileSync(new URL("index.html", dir), "utf8");
  for (const item of menuItems(home)) {
    const hash = item.split(" -> ")[1].match(/^#(.+)$/)?.[1];
    if (hash) assert.match(home, new RegExp(`id="${hash}"`), item);
  }
});

test("the homepage shows the interactive sample without a toggle", () => {
  const home = readFileSync(new URL("index.html", dir), "utf8");
  assert.match(home, /data-demo/);
  assert.doesNotMatch(home, /See the actual Mac app/);
  assert.match(home, /<noscript>[\s\S]*light-home\.png[\s\S]*<\/noscript>/);
});
