// The full name on this Mac's user account ("Miles Chu"), used as the person's name when they
// haven't set one in Settings. Google sign-in asks for no profile scope, so it gives no name.
import { execFile } from "node:child_process";

let cached: Promise<string> | undefined;

export function macUserName(): Promise<string> {
  cached ??= new Promise((resolve) => {
    if (process.platform !== "darwin") return resolve("");
    execFile("/usr/bin/id", ["-F"], { timeout: 2000 }, (error, stdout) =>
      resolve(error ? "" : stdout.trim().slice(0, 80)),
    );
  });
  return cached;
}
