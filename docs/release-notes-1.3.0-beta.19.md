# DayBoard 1.3.0-beta.19 — DayBoard Pro turns on

This is the first beta with licensing on. Everything that isn't AI stays free. AI features now
run a 14-day trial, and DayBoard Pro unlocks them for good.

## What changes for you

- **Free, with no license check:** Tasks, Gmail, Calendar, Reminders, sync and linking, notes,
  settings and the MCP server.
- **DayBoard Pro:** the Assistant, AI actions, dictation, AI parsing in Quick Capture and learned
  memories. Each Mac gets a 14-day trial that starts the first time you use one of them. No trial
  was recorded while licensing was off, so everyone who updates starts with the full 14 days,
  beta testers included.
- **After the trial,** the Assistant shows that the trial ended and other AI actions say a license
  is required. Nothing you wrote is lost, and everything else keeps working.
- **To unlock Pro,** open Settings → License, paste your key and click Activate. A key works on up
  to 3 Macs. To move it, choose "Deactivate this device" on the old Mac first. DayBoard checks the
  key once a day and keeps working offline for 30 days after the last good check.

DayBoard talks to the license service at `https://api.getdayboard.com` only to activate or
deactivate a key and for the daily check. The trial is tracked on your Mac.

## Also in this build

- **Send feedback from the app.** Help → Send Feedback… opens a new email to
  support@getdayboard.com with your DayBoard and macOS versions filled in. If your mail lives in a
  browser, Help → Copy Feedback Address copies the address instead. Settings → Updates has both in
  a new Feedback section (#92).
- In demo mode, opening a message from Home now shows it in the Inbox folder (#80).

## Updating

From beta.12 or later, DayBoard downloads beta.19 in the background and shows **Restart to
update** in the toolbar. Settings → Updates checks on request. If you don't restart, it installs
the next time you quit. Your data and sign-ins stay where they are.

If updates never arrive, make sure DayBoard was dragged into Applications in Finder. A copy put
there another way can run from a read-only location where macOS won't let it replace itself.
Dragging it out of Applications and back in Finder once fixes this.

Apple Silicon, macOS 14+. AI and MCP remain optional.

Questions: support@getdayboard.com.

## Release verification

The [signed release run](https://github.com/miles-chu10/DayBoard/actions/runs/42573752532)
published this prerelease on 2026-11-09 at 06:47 UTC from `350d99b`, the commit the
[signed beta dry run](https://github.com/miles-chu10/DayBoard/actions/runs/42571797367) built
first. The run passed its tests, build, Developer ID signing, app and DMG notarization, package
verification and fictional-data smoke checks. The release contains the DMG, ZIP, both blockmaps,
`latest-mac.yml`, `release-manifest.json` and `SHA256SUMS.txt`.

Checked on a Mac from the published downloads: every `SHA256SUMS.txt` line matches the files, and
`latest-mac.yml` gives this version with the ZIP's and DMG's actual SHA-512 and size. The DMG
passes `xcrun stapler validate`, and `spctl` accepts it as Notarized Developer ID. The apps in the
ZIP and the DMG are 1.3.0-beta.19 with the same code signature, pass
`codesign --verify --deep --strict` and `stapler validate`, and are accepted as Notarized
Developer ID (team `LGJS5APK9X`). The shipped `app.asar` names the live license service and the
live product, and no test product or test license service. An update from beta.18 has not yet
been observed.

DMG: `DayBoard-1.3.0-beta.19-arm64.dmg` (138,285,359 bytes). Its published SHA-256 is
`2a47c4796b0f618bce1e2215aa8e0918cd02c7ed5c669fa07aa48a00336be343`.
