import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Offline only: the download test talks to a local server, never to GitHub.
const require = createRequire(import.meta.url);
const builderConfig = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
const electronDownloadBlock =
  builderConfig.match(/^electronDownload:\n((?: {2}.*\n)+)/m)?.[1] ?? "";

function pinnedChecksums() {
  return Object.fromEntries(
    [...electronDownloadBlock.matchAll(/^ {4}(electron-v\S+\.zip): ([0-9a-f]{64})$/gm)].map(
      ([, file, sha]) => [file, sha],
    ),
  );
}

test("electron-builder.yml pins the installed Electron's checksums for every arm64 build", () => {
  const { version } = require("electron/package.json");
  const published = require("electron/checksums.json");
  const expected = Object.fromEntries(
    ["darwin-arm64", "mas-arm64"].map((target) => {
      const file = `electron-v${version}-${target}.zip`;
      return [file, published[file]];
    }),
  );
  assert.deepEqual(
    pinnedChecksums(),
    expected,
    `Update electronDownload.checksums in electron-builder.yml from node_modules/electron/checksums.json for Electron ${version}.`,
  );
  // ElectronFramework drops every option except the mirror when mirrorOptions is set, and treats
  // the config as plain download options (which ignore checksums) without one of these keys.
  assert.match(electronDownloadBlock, /^ {2}unsafelyDisableChecksums: false$/m);
  assert.doesNotMatch(electronDownloadBlock, /mirrorOptions/);
});

test("pinned checksums verify the Electron zip without downloading SHASUMS256.txt", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "dayboard-electron-download-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const name of [
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "https_proxy",
    "http_proxy",
    "ELECTRON_DOWNLOAD_CACHE_MODE",
  ]) {
    delete process.env[name];
  }
  // Keep @electron/get's and electron-builder's caches out of the real ones.
  process.env.HOME = home;
  process.env.XDG_CACHE_HOME = path.join(home, "cache");
  process.env.ELECTRON_BUILDER_CACHE = path.join(home, "builder-cache");

  const zip = randomBytes(4096);
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url.endsWith("/SHASUMS256.txt")) {
      response.writeHead(504).end();
      return;
    }
    response.writeHead(200, { "content-length": zip.length }).end(zip);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  process.env.ELECTRON_MIRROR = `http://127.0.0.1:${server.address().port}/`;

  const electronGet = require("app-builder-lib/out/util/electronGet.js");
  const extracted = [];
  electronGet.extractArchive = async (file) => {
    extracted.push(await readFile(file));
  };
  const {
    createElectronFrameworkSupport,
  } = require("app-builder-lib/out/electron/ElectronFramework.js");
  const version = "99.0.0";
  const file = `electron-v${version}-darwin-arm64.zip`;
  const stage = (sha) =>
    createElectronFrameworkSupport({ electronVersion: version }, {}).then((framework) =>
      framework.prepareApplicationStageDirectory({
        packager: {
          // Same option form as electron-builder.yml, pinned to the local zip.
          config: {
            electronDownload: { unsafelyDisableChecksums: false, checksums: { [file]: sha } },
          },
          appInfo: { type: "commonjs" },
          info: { getWorkspaceRoot: async () => home },
          projectDir: home,
        },
        appOutDir: path.join(home, "out"),
        platformName: "darwin",
        arch: "arm64",
        version,
      }),
    );

  await stage(createHash("sha256").update(zip).digest("hex"));
  assert.deepEqual(requests, [`/v${version}/${file}`]);
  assert.deepEqual(extracted, [zip]);

  // A wrong pin still fails verification instead of falling back to SHASUMS256.txt.
  requests.length = 0;
  process.env.ELECTRON_DOWNLOAD_CACHE_MODE = "3"; // Bypass, so the verified zip isn't reused.
  await assert.rejects(stage("0".repeat(64)), /checksum/i);
  assert.ok(requests.length > 0 && requests.every((url) => url === `/v${version}/${file}`));
  assert.equal(extracted.length, 1);
});
