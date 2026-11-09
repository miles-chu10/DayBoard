import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

import worker from "../website-worker/worker.js";

const root = join(import.meta.dirname, "..");
const site = join(root, "website");

function readConfig() {
  const text = readFileSync(join(root, "website-worker", "wrangler.jsonc"), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(text);
}

// Same matching as Cloudflare's asset router: `*` matches any characters, slashes included, and the
// whole pathname must match (workers-shared asset-worker/src/utils/rules-engine.ts).
function routesToWorker(rules, pathname) {
  const matches = (rule) =>
    new RegExp(
      `^${rule
        .split("*")
        .map((part) => part.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
        .join(".*")}$`,
    ).test(pathname);
  const positive = rules.filter((rule) => !rule.startsWith("!"));
  const negative = rules.filter((rule) => rule.startsWith("!")).map((rule) => rule.slice(1));
  return positive.some(matches) && !negative.some(matches);
}

function sitePaths(dir = site) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sitePaths(path);
    return [`/${relative(site, path).split(sep).join("/")}`];
  });
}

test("only video requests run the website Worker first", () => {
  const { assets } = readConfig();
  assert.ok(
    Array.isArray(assets.run_worker_first),
    "run_worker_first must list paths, not be true",
  );
  assert.equal(assets.directory, "../website");
  assert.equal(assets.not_found_handling, "404-page");

  const paths = sitePaths();
  const videos = paths.filter((path) => path.endsWith(".mp4"));
  assert.ok(videos.length > 0, "the site has at least one video");
  for (const path of paths) {
    assert.equal(
      routesToWorker(assets.run_worker_first, path),
      path.endsWith(".mp4"),
      `${path} ${path.endsWith(".mp4") ? "must" : "must not"} run the Worker first`,
    );
  }
  for (const path of ["/", "/pricing", "/download", "/beta"]) {
    assert.equal(routesToWorker(assets.run_worker_first, path), false, `${path} is a static page`);
  }
});

const video = new TextEncoder().encode("0123456789abcdefghij");

const env = {
  ASSETS: {
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/assets/video/missing.mp4") {
        return new Response("not found", { status: 404, headers: { "Content-Type": "text/html" } });
      }
      if (pathname.endsWith(".mp4")) {
        return new Response(request.method === "HEAD" ? null : video, {
          headers: { "Content-Type": "video/mp4", ETag: '"v1"', "Content-Length": "20" },
        });
      }
      return new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } });
    },
  },
};

const get = (url, headers = {}, method = "GET") =>
  worker.fetch(new Request(url, { method, headers }), env);

test("the Worker redirects http and www to the https apex, keeping path and query", async () => {
  for (const [from, to] of [
    ["http://getdayboard.com/pricing?x=1", "https://getdayboard.com/pricing?x=1"],
    [
      "https://www.getdayboard.com/assets/video/a.mp4?t=1",
      "https://getdayboard.com/assets/video/a.mp4?t=1",
    ],
    ["http://www.getdayboard.com/", "https://getdayboard.com/"],
  ]) {
    const res = await get(from);
    assert.equal(res.status, 301, from);
    assert.equal(res.headers.get("Location"), to, from);
  }
});

test("video answers byte ranges so Safari can play it", async () => {
  const url = "https://getdayboard.com/assets/video/a.mp4";
  const cases = [
    ["bytes=0-4", "bytes 0-4/20", "01234"],
    ["bytes=10-", "bytes 10-19/20", "abcdefghij"],
    ["bytes=-5", "bytes 15-19/20", "fghij"],
    ["bytes=18-99", "bytes 18-19/20", "ij"],
  ];
  for (const [range, contentRange, body] of cases) {
    const res = await get(url, { Range: range });
    assert.equal(res.status, 206, range);
    assert.equal(res.headers.get("Content-Range"), contentRange, range);
    assert.equal(res.headers.get("Content-Length"), String(body.length), range);
    assert.equal(res.headers.get("Accept-Ranges"), "bytes", range);
    assert.equal(await res.text(), body, range);
  }

  const outside = await get(url, { Range: "bytes=25-" });
  assert.equal(outside.status, 416);
  assert.equal(outside.headers.get("Content-Range"), "bytes */20");

  const whole = await get(url);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("Accept-Ranges"), "bytes");
  assert.equal(await whole.text(), "0123456789abcdefghij");

  const stale = await get(url, { Range: "bytes=0-4", "If-Range": '"old"' });
  assert.equal(stale.status, 200, "a changed file is sent whole");
  assert.equal((await stale.arrayBuffer()).byteLength, 20);
});

test("other responses pass through unchanged", async () => {
  const page = await get("https://getdayboard.com/missing-page");
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("Accept-Ranges"), null);

  const missing = await get("https://getdayboard.com/assets/video/missing.mp4", {
    Range: "bytes=0-4",
  });
  assert.equal(missing.status, 404);

  const head = await get(
    "https://getdayboard.com/assets/video/a.mp4",
    { Range: "bytes=0-4" },
    "HEAD",
  );
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Accept-Ranges"), null);
});
