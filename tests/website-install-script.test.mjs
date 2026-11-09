import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const scriptUrl = new URL("../website/install.sh", import.meta.url);
const source = readFileSync(scriptUrl, "utf8");
const FIXTURE = "not a real disk image\n";
const TEAM = "LGJS5APK9X";

// Stand-ins for the macOS tools the installer calls, so it can run on any machine with bash.
const stubs = {
  uname: `[ "$1" = "-s" ] && echo "\${FAKE_OS:-Darwin}"`,
  sysctl: `echo "\${FAKE_ARM64:-1}"`,
  sw_vers: `echo "\${FAKE_MACOS:-15.1}"`,
  pgrep: `[ "\${FAKE_RUNNING:-0}" = "1" ]`,
  curl: `while [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; shift; done
[ "\${FAKE_OFFLINE:-0}" = "1" ] && exit 22
printf '%s' "$FAKE_DOWNLOAD" > "$out"`,
  codesign: `case "$1" in
  --display) echo "TeamIdentifier=\${FAKE_TEAM}" >&2 ;;
  --verify) [ "\${FAKE_BROKEN_SIGNATURE:-0}" = "0" ] ;;
esac`,
  spctl: `echo "accepted" >&2; echo "source=\${FAKE_SOURCE}" >&2`,
  hdiutil: `if [ "$1" = "attach" ]; then
  while [ $# -gt 0 ]; do [ "$1" = "-mountpoint" ] && mount="$2"; shift; done
  mkdir -p "$mount/DayBoard.app/Contents" && echo "new" > "$mount/DayBoard.app/Contents/marker"
fi`,
  ditto: `cp -R "$1" "$2"`,
};

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "dayboard-install-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const apps = join(root, "Applications");
  mkdirSync(bin);
  mkdirSync(apps);
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return { root, bin, apps };
}

// Runs a copy of the installer that finds the stand-in tools first and expects the fixture's hash.
function install(t, { env = {}, keepPublishedHash = false, existing = false } = {}) {
  const box = sandbox(t);
  let script = source.replace(/^PATH="[^"]*"$/m, `PATH="${box.bin}:/usr/bin:/bin:/usr/sbin:/sbin"`);
  if (!keepPublishedHash) {
    const hash = createHash("sha256").update(FIXTURE).digest("hex");
    script = script.replace(/^DMG_SHA256="[0-9a-f]{64}"$/m, `DMG_SHA256="${hash}"`);
  }
  assert.notEqual(script, source, "the test copy points at the stand-in tools");
  if (existing) {
    mkdirSync(join(box.apps, "DayBoard.app", "Contents"), { recursive: true });
    writeFileSync(join(box.apps, "DayBoard.app", "Contents", "marker"), "old\n");
  }
  const result = spawnSync("bash", [], {
    input: script,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      TMPDIR: box.root,
      DAYBOARD_INSTALL_DIR: box.apps,
      FAKE_DOWNLOAD: FIXTURE,
      FAKE_TEAM: TEAM,
      FAKE_SOURCE: "Notarized Developer ID",
      ...env,
    },
  });
  const marker = join(box.apps, "DayBoard.app", "Contents", "marker");
  return {
    ...result,
    installed: existsSync(marker) ? readFileSync(marker, "utf8").trim() : null,
    leftovers: readdirSync(box.apps).filter((name) => name !== "DayBoard.app"),
    temp: readdirSync(box.root).filter((name) => name.startsWith("dayboard-install.")),
  };
}

test("installs a verified download and cleans up after itself", (t) => {
  const run = install(t);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.installed, "new");
  assert.deepEqual(run.leftovers, []);
  assert.deepEqual(run.temp, []);
  assert.match(run.stdout, /DayBoard \S+ is installed/);
});

test("replaces an older copy when DayBoard is closed", (t) => {
  const run = install(t, { existing: true });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.installed, "new");
  assert.deepEqual(run.leftovers, []);
});

test("leaves the installed copy alone while DayBoard is open", (t) => {
  const run = install(t, { existing: true, env: { FAKE_RUNNING: "1" } });
  assert.equal(run.status, 1);
  assert.equal(run.installed, "old");
  assert.match(run.stderr, /DayBoard is open/);
});

const refusals = [
  ["a download whose SHA-256 differs", { keepPublishedHash: true }, /SHA-256/],
  ["a failed download", { env: { FAKE_OFFLINE: "1" } }, /download failed/],
  ["another developer's signature", { env: { FAKE_TEAM: "ABCDE12345" } }, /Developer ID team/],
  ["an app that isn't notarized", { env: { FAKE_SOURCE: "Developer ID" } }, /not notarized/],
  ["a broken app signature", { env: { FAKE_BROKEN_SIGNATURE: "1" } }, /signature is not valid/],
  ["an Intel Mac", { env: { FAKE_ARM64: "0" } }, /Apple silicon/],
  ["macOS 13", { env: { FAKE_MACOS: "13.6.1" } }, /macOS 14/],
  ["another operating system", { env: { FAKE_OS: "Linux" } }, /Mac app/],
];

for (const [name, options, message] of refusals) {
  test(`refuses ${name} and installs nothing`, (t) => {
    const run = install(t, { ...options, existing: true });
    assert.equal(run.status, 1);
    assert.match(run.stderr, message);
    assert.equal(run.installed, "old", "the existing copy is untouched");
    assert.deepEqual(run.leftovers, []);
    assert.deepEqual(run.temp, []);
  });
}

test("the published script is complete, pinned and never asks for a password", () => {
  assert.equal(spawnSync("bash", ["-n"], { input: source }).status, 0, "bash can parse it");
  assert.match(source, /^VERSION="\d+\.\d+\.\d+-beta\.\d+"$/m);
  assert.match(source, /^DMG_SHA256="[0-9a-f]{64}"$/m);
  assert.match(source, new RegExp(`^TEAM_ID="${TEAM}"$`, "m"));
  assert.match(source, /^PATH="\/usr\/bin:\/bin:\/usr\/sbin:\/sbin"$/m);
  assert.match(source, /https:\/\/github\.com\/miles-chu10\/DayBoard\/releases\/download\//);
  assert.doesNotMatch(source, /^\s*sudo\b/m);
  assert.match(source.trimEnd(), /\nmain "\$@"$/, "nothing runs until the last line arrives");
});
