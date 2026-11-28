import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertFuses,
  expectedFuses,
  readFuses,
  verifyAppFuses,
} from "../scripts/electron-fuses.mjs";

// Synthetic binaries only: the wire layout is @electron/fuses' (sentinel, version, length, states).
const SENTINEL = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
const order = [
  "runAsNode",
  "enableCookieEncryption",
  "enableNodeOptionsEnvironmentVariable",
  "enableNodeCliInspectArguments",
  "enableEmbeddedAsarIntegrityValidation",
  "onlyLoadAppFromAsar",
  "loadBrowserProcessSpecificV8Snapshot",
  "grantFileProtocolExtraPrivileges",
];

function binary(fuses = expectedFuses, { length = 9, version = 1, slices = 1 } = {}) {
  const states = order.map((name) => (fuses[name] ? 0x31 : 0x30));
  while (states.length < length) states.push(0x30);
  const wire = Buffer.concat([
    Buffer.from("junk before the wire"),
    Buffer.from(SENTINEL),
    Buffer.from([version, length, ...states.slice(0, length)]),
    Buffer.from("junk after the wire"),
  ]);
  return Buffer.concat(Array.from({ length: slices }, () => wire));
}

test("electron-builder.yml flips exactly the fuses the packaging checks expect", async () => {
  const config = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
  const block = config.match(/^electronFuses:\n((?: {2}.*\n)+)/m)?.[1] ?? "";
  const configured = Object.fromEntries(
    [...block.matchAll(/^ {2}(\w+): (true|false)$/gm)].map(([, name, value]) => [
      name,
      value === "true",
    ]),
  );
  assert.deepEqual(configured, expectedFuses);
});

test("the release posture turns off Node entry points and locks the app to its signed asar", () => {
  assert.equal(expectedFuses.runAsNode, false);
  assert.equal(expectedFuses.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(expectedFuses.enableCookieEncryption, true);
  assert.equal(expectedFuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(expectedFuses.onlyLoadAppFromAsar, true);
  // Kept on deliberately: packaged smoke tests attach with --inspect, windows load from file://.
  assert.equal(expectedFuses.enableNodeCliInspectArguments, true);
  assert.equal(expectedFuses.grantFileProtocolExtraPrivileges, true);
});

test("reads the fuse wire and accepts a binary flipped as configured", () => {
  assert.deepEqual(readFuses(binary()), expectedFuses);
  assert.doesNotThrow(() => assertFuses(readFuses(binary())));
  assert.doesNotThrow(() => assertFuses(readFuses(binary(expectedFuses, { slices: 2 }))));
});

test("rejects Electron's defaults and any single fuse left wrong, naming it", () => {
  const defaults = {
    runAsNode: true,
    enableCookieEncryption: false,
    enableNodeOptionsEnvironmentVariable: true,
    enableNodeCliInspectArguments: true,
    enableEmbeddedAsarIntegrityValidation: false,
    onlyLoadAppFromAsar: false,
    grantFileProtocolExtraPrivileges: true,
  };
  assert.throws(() => assertFuses(readFuses(binary(defaults)), "DMG app"), {
    message:
      "The DMG app's Electron fuses are wrong: runAsNode should be off, enableCookieEncryption should be on, enableNodeOptionsEnvironmentVariable should be off, enableEmbeddedAsarIntegrityValidation should be on, onlyLoadAppFromAsar should be on.",
  });
  for (const name of Object.keys(expectedFuses)) {
    const wrong = { ...expectedFuses, [name]: !expectedFuses[name] };
    assert.throws(() => assertFuses(readFuses(binary(wrong))), new RegExp(`${name} should be`));
  }
});

test("refuses binaries without a readable wire", () => {
  assert.throws(() => readFuses(Buffer.from("no wire here")), /no fuse wire/);
  assert.throws(() => readFuses(binary(expectedFuses, { version: 2 })), /version 2/);
  assert.throws(() => readFuses(binary(expectedFuses, { length: 6 })), /no grantFileProtocol/);
  const removed = binary();
  removed[removed.indexOf(SENTINEL) + SENTINEL.length + 2] = 0x72; // "r": removed fuse
  assert.throws(() => readFuses(removed), /runAsNode fuse has an unexpected state/);
  const mixed = Buffer.concat([binary(), binary({ ...expectedFuses, runAsNode: true })]);
  assert.throws(() => readFuses(mixed), /universal binary disagree/);
});

test("reads the Electron Framework binary inside the app bundle", () => {
  const paths = [];
  verifyAppFuses("/fixture/DayBoard.app", "app", (file) => {
    paths.push(file);
    return binary();
  });
  assert.deepEqual(paths, [
    "/fixture/DayBoard.app/Contents/Frameworks/Electron Framework.framework/Electron Framework",
  ]);
});
