import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const STORES = new Set(["file", "keyring", "auto"]);

/** The top-level `cli_auth_credentials_store` of a Codex config.toml, or null when unset. */
export function authStoreFromConfig(toml: string): string | null {
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    // Top-level keys come before the first table header.
    if (line.startsWith("[")) return null;
    const match = /^cli_auth_credentials_store\s*=\s*"([a-z]+)"\s*(?:#.*)?$/.exec(line);
    if (match) return STORES.has(match[1]!) ? match[1]! : null;
  }
  return null;
}

/**
 * `--ignore-user-config` also drops where the user's Codex login is stored, so a login kept in
 * the Keychain would send no credentials. Pass just that one setting through.
 */
export async function codexAuthArgs(env: NodeJS.ProcessEnv): Promise<string[]> {
  const home = env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const toml = await fs.readFile(path.join(home, "config.toml"), "utf8").catch(() => "");
  const store = authStoreFromConfig(toml);
  return store ? ["-c", `cli_auth_credentials_store=${JSON.stringify(store)}`] : [];
}
