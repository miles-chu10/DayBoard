import { readFileSync } from "node:fs";
import path from "node:path";

// Mirrors `electronFuses` in electron-builder.yml (tests/electron-fuses.test.mjs keeps them equal).
// Indexes are Electron's FuseV1Options order.
export const expectedFuses = {
  runAsNode: false,
  enableCookieEncryption: true,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: true,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  grantFileProtocolExtraPrivileges: true,
};

const fuseIndex = {
  runAsNode: 0,
  enableCookieEncryption: 1,
  enableNodeOptionsEnvironmentVariable: 2,
  enableNodeCliInspectArguments: 3,
  enableEmbeddedAsarIntegrityValidation: 4,
  onlyLoadAppFromAsar: 5,
  grantFileProtocolExtraPrivileges: 7,
};

const SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
const DISABLED = 0x30;
const ENABLED = 0x31;

/** Reads the fuse wire from an Electron Framework binary, as `@electron/fuses` lays it out. */
export function readFuses(binary) {
  const sentinel = binary.indexOf(SENTINEL);
  if (sentinel === -1) throw new Error("The Electron binary has no fuse wire.");
  const wire = sentinel + SENTINEL.length;
  if (binary[wire] !== 1) throw new Error(`Unknown fuse wire version ${binary[wire]}.`);
  const length = binary[wire + 1];
  const fuses = {};
  for (const [name, index] of Object.entries(fuseIndex)) {
    if (index >= length) throw new Error(`The fuse wire has no ${name} fuse.`);
    const state = binary[wire + 2 + index];
    if (state !== DISABLED && state !== ENABLED)
      throw new Error(`The ${name} fuse has an unexpected state.`);
    fuses[name] = state === ENABLED;
  }
  // A universal binary carries a second wire; both slices must agree.
  const last = binary.lastIndexOf(SENTINEL);
  if (last !== sentinel) {
    const other = readFuses(binary.subarray(last));
    if (JSON.stringify(other) !== JSON.stringify(fuses))
      throw new Error("The fuse wires of a universal binary disagree.");
  }
  return fuses;
}

export function assertFuses(fuses, label = "app") {
  const wrong = Object.entries(expectedFuses)
    .filter(([name, value]) => fuses[name] !== value)
    .map(([name, value]) => `${name} should be ${value ? "on" : "off"}`);
  if (wrong.length)
    throw new Error(`The ${label}'s Electron fuses are wrong: ${wrong.join(", ")}.`);
}

export function verifyAppFuses(appPath, label = "app", read = readFileSync) {
  const framework = path.join(
    appPath,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Electron Framework",
  );
  assertFuses(readFuses(read(framework)), label);
}
