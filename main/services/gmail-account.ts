// The Gmail app password, stored encrypted like other credentials. It belongs to one Google
// account: a different signed-in account never uses it.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { app, safeStorage } from "../platform/index.js";

import { createSerialQueue, readFileIfExists, writeFileAtomic } from "./file-store.js";

export interface GmailCredentials {
  email: string;
  password: string;
}

const queue = createSerialQueue();
let cached: GmailCredentials | null | undefined;

function credentialsPath(): string {
  return path.join(app.getPath("userData"), "gmail-app-password.bin");
}

/** Google shows app passwords as four groups of four letters; spaces are only for reading. */
export function normalizeAppPassword(value: string): string {
  const password = value.replace(/\s+/g, "");
  if (!/^[a-z]{16}$/i.test(password))
    throw new Error(
      "That isn’t an app password. Google’s app passwords are 16 letters, like “abcd efgh ijkl mnop”.",
    );
  return password.toLowerCase();
}

export function readGmailCredentials(): Promise<GmailCredentials | null> {
  return queue(async () => {
    if (cached !== undefined) return cached;
    const stored = await readFileIfExists(credentialsPath());
    if (!stored) return (cached = null);
    const parsed: unknown = JSON.parse(await safeStorage.decryptString(stored));
    const record = parsed as Partial<GmailCredentials> | null;
    cached =
      typeof record?.email === "string" && typeof record.password === "string"
        ? { email: record.email, password: record.password }
        : null;
    return cached;
  });
}

export function saveGmailCredentials(credentials: GmailCredentials): Promise<void> {
  return queue(async () => {
    await writeFileAtomic(
      credentialsPath(),
      await safeStorage.encryptString(JSON.stringify(credentials)),
    );
    cached = credentials;
  });
}

export function clearGmailCredentials(): Promise<void> {
  return queue(async () => {
    await fs.rm(credentialsPath(), { force: true });
    cached = null;
  });
}
