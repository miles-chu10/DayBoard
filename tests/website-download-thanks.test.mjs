import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (name) => readFile(new URL(`../website/${name}`, import.meta.url), "utf8");
const source = await read("assets/site.js");
const dmg = (version) =>
  `https://github.com/miles-chu10/DayBoard/releases/download/v${version}/DayBoard-${version}-arm64.dmg`;

// Runs the real site script against a stand-in page: download buttons with the given hrefs, and
// optionally the thanks page's parts with the given URL fragment.
function page({ hrefs = [], hash, thanks = false } = {}) {
  const assigned = [];
  const timers = [];
  const note = { hidden: true };
  const buttons = hrefs.map((href) => {
    const button = {
      href,
      parentElement: { querySelector: () => note, parentElement: null },
      addEventListener: (type, listener) => {
        if (type === "click") button.click = listener;
      },
    };
    return button;
  });
  const link = { href: "download.html" };
  const start = { hidden: true, querySelector: () => link };
  const idle = { hidden: false };
  vm.runInNewContext(source, {
    document: {
      querySelector: (selector) =>
        !thanks
          ? null
          : selector === "[data-download-start]"
            ? start
            : selector === "[data-download-idle]"
              ? idle
              : null,
      querySelectorAll: (selector) => (selector === "a[data-download]" ? buttons : []),
    },
    window: { scrollY: 0, addEventListener() {} },
    location: { hostname: "getdayboard.com", hash, assign: (url) => assigned.push(url) },
    setTimeout: (callback, ms) => timers.push({ callback, ms }),
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    URL,
  });
  return { assigned, timers, note, buttons, link, start, idle };
}
const click = (button, keys = {}) => {
  let prevented = false;
  button.click({ preventDefault: () => (prevented = true), ...keys });
  return prevented;
};

test("a download button opens the thanks page with only the version", () => {
  const view = page({ hrefs: [dmg("1.3.13"), dmg("1.4.0-beta.2")] });
  assert.equal(click(view.buttons[0]), true);
  assert.equal(click(view.buttons[1]), true);
  assert.deepEqual(view.assigned, ["thanks.html#1.3.13", "thanks.html#1.4.0-beta.2"]);
  assert.equal(view.note.hidden, true);
});

test("a modified click or an unexpected link downloads directly and shows the next step", () => {
  for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
    const view = page({ hrefs: [dmg("1.3.13")] });
    assert.equal(click(view.buttons[0], { [key]: true }), false, key);
    assert.deepEqual(view.assigned, []);
    assert.equal(view.note.hidden, false);
  }
  for (const href of [
    "https://example.test/releases/download/v1.3.13/DayBoard-1.3.13-arm64.dmg",
    "https://github.com/miles-chu10/DayBoard/releases/download/v1.3.13/Other-1.3.13-arm64.dmg",
    "https://github.com/miles-chu10/DayBoard/releases/download/v1.3.13/DayBoard-1.3.12-arm64.dmg",
  ]) {
    const view = page({ hrefs: [href] });
    assert.equal(click(view.buttons[0]), false, href);
    assert.deepEqual(view.assigned, []);
  }
});

test("the thanks page starts the release DMG named by its fragment, and nothing else", () => {
  const view = page({ thanks: true, hash: "#1.3.13" });
  assert.equal(view.start.hidden, false);
  assert.equal(view.idle.hidden, true);
  assert.equal(view.link.href, dmg("1.3.13"));
  assert.deepEqual(view.assigned, []);
  assert.equal(view.timers.length, 1);
  view.timers[0].callback();
  assert.deepEqual(view.assigned, [dmg("1.3.13")]);

  for (const hash of [
    "",
    "#",
    "#https://example.test/x.dmg",
    "#1.3",
    "#1.3.13/../../x",
    "#v1.3.13",
  ]) {
    const other = page({ thanks: true, hash });
    assert.equal(other.start.hidden, true, hash);
    assert.equal(other.idle.hidden, false, hash);
    assert.equal(other.link.href, "download.html", hash);
    assert.equal(other.timers.length, 0, hash);
  }
});

test("the thanks page is not indexed, names no version and works without scripts", async () => {
  const html = await read("thanks.html");
  assert.match(html, /<meta name="robots" content="noindex" \/>/);
  assert.doesNotMatch(html, /releases\/download/);
  assert.match(html, /<p data-download-start hidden>/);
  assert.match(html, /<p data-download-idle>[\s\S]*?href="download\.html"/);
  assert.doesNotMatch(await read("sitemap.xml"), /thanks/);
});

test("the privacy page says download starts are counted", async () => {
  assert.match(
    (await read("privacy.html")).replace(/\s+/g, " "),
    /A download button opens a thanks page first, so those totals include how many downloads were started\./,
  );
});
