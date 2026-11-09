# DayBoard 1.3.0-beta.21 — Collapsible overdue on Home and in the menu bar

This beta folds overdue items into one row on Home and in the menu-bar panel, so a long overdue
list no longer pushes today out of view. Licensing works as in beta.20: everything that isn't AI
is free, AI runs a 14-day trial on each Mac, and DayBoard Pro unlocks it for good.

## New

- **Overdue folds into one row on Home.** Home's Agenda card now starts with a single
  "N overdue tasks" row, like the Agenda page. Click it to see the overdue items, and Home
  remembers whether you left it open (#106).
- **The same row in the menu bar.** The menu-bar panel used to show only an overdue count. It now
  has the same collapsible row, listing up to eight overdue to-dos with how late each one is. A
  link opens DayBoard for the rest, and the panel also remembers whether you left the row open
  (#108).

## Fixed

- **Zero-length events no longer block planning slots.** When you plan a time for a to-do, a
  Google Calendar event that starts and ends at the same moment (such as 10:00–10:00) no longer
  marks that time as busy (#104).

## Updating

From beta.12 or later, DayBoard downloads beta.21 in the background and shows **Restart to
update** in the toolbar. Settings → Updates checks on request. If you don't restart, it installs
the next time you quit. Your data, sign-ins, trial and license stay where they are.

If updates never arrive, make sure DayBoard was dragged into Applications in Finder. A copy put
there another way can run from a read-only location where macOS won't let it replace itself.
Dragging it out of Applications and back in Finder once fixes this.

Apple Silicon, macOS 14+. AI and MCP remain optional.

Questions: support@getdayboard.com.

## Release verification

The [signed release run](https://github.com/miles-chu10/DayBoard/actions/runs/42688752669)
published this prerelease on 2026-11-09 at 20:18 UTC from `3f54b2d`, the commit the
[signed beta dry run](https://github.com/miles-chu10/DayBoard/actions/runs/42685187126) built
first. The release contains the DMG, ZIP, both blockmaps, `latest-mac.yml`,
`release-manifest.json` and `SHA256SUMS.txt`.

Checked against the published assets: the DMG and ZIP lines in `SHA256SUMS.txt` match the
SHA-256 digests GitHub reports for those files, and `latest-mac.yml` gives this version with the
ZIP's and DMG's published sizes. The DMG downloaded on a Mac has the SHA-256 below and the SHA-512
in `latest-mac.yml`, passes `xcrun stapler validate`, and `spctl` accepts it as Notarized
Developer ID (team `LGJS5APK9X`). The ZIP was not downloaded separately.

Update from beta.20: on 2026-11-09 at 20:39 UTC, an installed beta.20 installed this release
through the in-app updater and relaunched. The installed app is 1.3.0-beta.21, passes
`codesign --verify --deep --strict` and `stapler validate`, and is accepted as Notarized
Developer ID. Settings → Updates shows 1.3.0-beta.21 and "DayBoard is up to date", and
Settings → License shows DayBoard Pro. On Home, 18 overdue items show as one
"18 overdue tasks" row that opens and closes. The menu-bar panel shows the same row. When open,
it lists eight overdue to-dos and a "10 more in DayBoard" link.

DMG: `DayBoard-1.3.0-beta.21-arm64.dmg` (138,344,080 bytes). Its published SHA-256 is
`0d219fb8f72fdd29c532ecc9e73db18779e20deccc8a576098625b2d729c1ba4`.
