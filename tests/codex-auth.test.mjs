import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { authStoreFromConfig, codexAuthArgs } = await loadTs("main/services/ai/codex-auth.ts");

test("reads the top-level Codex credential store", () => {
  assert.equal(
    authStoreFromConfig('cli_auth_credentials_store = "keyring"\nmodel = "x"\n'),
    "keyring",
  );
  assert.equal(authStoreFromConfig('  cli_auth_credentials_store="file" # saved\n'), "file");
  assert.equal(authStoreFromConfig('model = "x"\ncli_auth_credentials_store = "auto"'), "auto");
});

test("ignores a missing, unknown or table-scoped credential store", () => {
  assert.equal(authStoreFromConfig(""), null);
  assert.equal(authStoreFromConfig('model = "x"\n'), null);
  assert.equal(authStoreFromConfig('cli_auth_credentials_store = "cloud"\n'), null);
  assert.equal(
    authStoreFromConfig('[profiles.work]\ncli_auth_credentials_store = "keyring"\n'),
    null,
    "only the top level applies",
  );
});

test("passes the user's credential store to a run that ignores the user config", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  assert.deepEqual(await codexAuthArgs({ CODEX_HOME: home }), [], "no config, no override");
  await fs.writeFile(path.join(home, "config.toml"), 'cli_auth_credentials_store = "keyring"\n');
  assert.deepEqual(await codexAuthArgs({ CODEX_HOME: home }), [
    "-c",
    'cli_auth_credentials_store="keyring"',
  ]);
});
