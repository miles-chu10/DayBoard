import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../website/assets/demo.css", import.meta.url), "utf8");
const rule = (selector) =>
  css.match(new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";

// On phones the sample stacks into a column. Without min-height: 0 these flex items grow to fit
// their content, so the sample is clipped, can't scroll, and swallows page swipes on iPhone.
test("sample panes can shrink so the sample scrolls inside its window", () => {
  assert.match(rule(".demo-workspace"), /min-height: 0;/);
  assert.match(rule(".demo-main"), /min-height: 0;/);
});

test("phone swipes that reach the end of the sample keep scrolling the page", () => {
  const phone = css.slice(css.indexOf("@media (max-width: 720px)"));
  assert.match(phone, /\.demo-content \{[^}]*overscroll-behavior: auto;/);
});
