# Proposal: set Electron fuses for release builds

Status: step A plus ASAR lock-down approved by Miles on 2026-11-24 and implemented in
`electron-builder.yml` (`electronFuses`). `EnableNodeCliInspectArguments` stays on for now; see
"Inspector fuse" below. `scripts/electron-fuses.mjs` reads the fuse wire back from every packaged
app (preview, test, QA, and the signed app, ZIP and DMG copies in the release and beta workflows)
and fails the build when it differs.

## Current state

REA `inspect_electron_fuses` on the installed `/Applications/DayBoard.app` (1.3.0-beta.11-local,
Electron Framework sha256 `d7867a81…bc4`) reads every fuse at Electron's default:

| Fuse                                  | State    | Effect                                                                    |
| ------------------------------------- | -------- | ------------------------------------------------------------------------- |
| RunAsNode                             | enabled  | `ELECTRON_RUN_AS_NODE=1` turns the signed app into a general Node runtime |
| EnableNodeOptionsEnvironmentVariable  | enabled  | `NODE_OPTIONS` can inject code at startup                                 |
| EnableNodeCliInspectArguments         | enabled  | `--inspect` / SIGUSR1 can attach a debugger to the main process           |
| EnableEmbeddedAsarIntegrityValidation | disabled | `app.asar` is not checked against a signed hash                           |
| OnlyLoadAppFromAsar                   | disabled | Electron also looks for app code outside `app.asar`                       |
| EnableCookieEncryption                | disabled | the cookie store is not encrypted at rest                                 |
| GrantFileProtocolExtraPrivileges      | enabled  | `file://` pages keep extra privileges                                     |

## Proposal

electron-builder 26.15.3 (installed) supports an `electronFuses` block. For **release builds
only** (`npm run dist` and the signed beta workflow), set:

```yaml
electronFuses:
  runAsNode: false
  enableNodeOptionsEnvironmentVariable: false
  enableNodeCliInspectArguments: false
  enableEmbeddedAsarIntegrityValidation: true
  onlyLoadAppFromAsar: true
  enableCookieEncryption: true
```

Leave `grantFileProtocolExtraPrivileges` enabled: DayBoard's windows load from `file://`.
Changing that needs a custom protocol first.

## Risks to check before enabling

- DayBoard's own code does not use `ELECTRON_RUN_AS_NODE`, `process.fork` or `utilityProcess`
  (checked: `main/`, `scripts/`). `node-pty` uses its unpacked `spawn-helper`, unaffected.
- Packaged e2e (`DAYBOARD_E2E_EXECUTABLE`) launches through Playwright, which needs the inspector.
  Keep fuses off for `package:test` and the preview build, or e2e against packaged apps stops working.
- ASAR integrity requires electron-builder to write the hash into `Info.plist` during signing.
  Verify the signed beta launches and that the updater-installed version still validates.
- Cookie encryption is one-way for the existing cookie store (Google sign-in uses Keychain-backed
  tokens, not cookies, so the impact should be nil; verify sign-in persists across the update).

## Next step

If approved: add the block behind the release build path, build the signed beta, re-run REA
`inspect_electron_fuses` on the result, and run the packaged smoke tests against the preview build.

## Inspector fuse (not yet off)

Playwright's `_electron.launch` always passes `--inspect=0` and `--remote-debugging-port=0`
(playwright-core 1.63 `coreBundle.js`), and the release and beta workflows smoke-test the signed
app that way before publishing. Turning `EnableNodeCliInspectArguments` off would make that step
fail. Options for a follow-up, each Miles's call because it changes what the release smoke test
proves:

1. Smoke-test an ad-hoc re-signed copy with only the inspector fuse turned back on, then ship the
   untouched signed app.
2. Move the packaged smoke test to a check that drives the app without the Node inspector.
