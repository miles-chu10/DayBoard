# DayBoard 1.3.0-beta.22 — One-line Inbox rows and fixes for lost edits

This beta is the release candidate for DayBoard 1.3.0. It makes the Inbox easier to scan, asks
before a license is deactivated, and fixes four cases where typed work or the wrong account could
slip through. Licensing works as in beta.21: everything that isn't AI is free, AI runs a 14-day
trial on each Mac, and DayBoard Pro unlocks it for good.

## New

- **Inbox emails on one line.** Each Inbox row now shows sender, subject, triage chip and time on
  a single line. Reply, Add task, Archive and Open in Gmail take the time's place when you hover,
  focus or select a row, and the selected row shows its preview. Settings → General → Inbox rows →
  With preview keeps the three-line rows. Mail rows on the Agenda are unchanged (#117).
- **A confirmation before deactivating.** Settings → License → Deactivate this device now asks
  first, and reminds you to have your key saved because it isn't emailed (#110).

## Fixed

- **Event edits survive a calendar refresh.** An open event editor no longer resets, or turns
  read-only, when the calendar refreshes in the background (#115).
- **Note text survives a failed save.** If saving a note fails, the text stays queued and saves
  on the next try. Back stays in the editor while the save is failing, and a deleted note doesn't
  come back (#115).
- **Undo send keeps its account.** An email waiting in its Undo window is sent only from the
  Google account it was written in. If you switched accounts, DayBoard shows "Couldn't send" with
  Edit instead (#115).
- **Google sign-in no longer blocks saves.** While the sign-in browser tab was open, saves and a
  normal quit could stall for up to ten minutes. They now work during sign-in, and signing out
  stays signed out (#115).

## Updating

From beta.12 or later, DayBoard downloads beta.22 in the background and shows **Restart to
update** in the toolbar. Settings → Updates checks on request. If you don't restart, it installs
the next time you quit. Your data, sign-ins, trial and license stay where they are.

If updates never arrive, make sure DayBoard was dragged into Applications in Finder. A copy put
there another way can run from a read-only location where macOS won't let it replace itself.
Dragging it out of Applications and back in Finder once fixes this.

Apple Silicon, macOS 14+. AI and MCP remain optional.

Questions: support@getdayboard.com.

## Release verification

The [signed release run](https://github.com/miles-chu10/DayBoard/actions/runs/43159907828)
published this prerelease on 2026-11-12 at 05:28 UTC from `2fbb738`, the commit the
[signed beta dry run](https://github.com/miles-chu10/DayBoard/actions/runs/43157148759) built
first. The run passed its tests, build, Developer ID signing, app and DMG notarization, package
verification and fictional-data smoke checks. The release contains the DMG, ZIP, both blockmaps,
`latest-mac.yml`, `release-manifest.json` and `SHA256SUMS.txt`.

Checked on a Mac from the published downloads: every `SHA256SUMS.txt` line matches the files and
GitHub's own digests, and `latest-mac.yml` gives this version with the ZIP's and DMG's actual
SHA-512 and size. The DMG passes `xcrun stapler validate`, and `spctl` accepts it as Notarized
Developer ID. The apps in the ZIP and the DMG are 1.3.0-beta.22, pass
`codesign --verify --deep --strict` and `stapler validate`, and are accepted as Notarized
Developer ID (team `LGJS5APK9X`). The shipped `app.asar` names the live license service and the
live product, and no other product.

Update from beta.21: on 2026-11-12 at 05:43 UTC, an installed beta.21 found beta.22 through
Settings → Updates and installed it with the in-app updater. The installer finished with status
0, and the relaunched app is 1.3.0-beta.22 with the same code signature as the app in the
published ZIP, accepted as Notarized Developer ID. The update left the settings file untouched,
and Google sign-in and the DayBoard Pro license were kept: the app came back signed in, with Pro
active.

Checked in the updated app with a real account: the Inbox shows one line per email with sender,
subject, triage chip and time, and Reply, Archive and Open in Gmail take the time's place on the
row with keyboard focus. Settings → General → Inbox rows → With preview brings back the
three-line rows, and One line restores them. Settings → License → Deactivate this device opens
the confirmation, and Cancel leaves Pro active. Not clicked through on the real account, because
each would change real mail, events or notes: the preview on an opened email (opening an unread
email marks it read), the Add task action, and the four #115 fixes. Those are covered by the
tests in the release run.

DMG: `DayBoard-1.3.0-beta.22-arm64.dmg` (138,340,119 bytes). Its published SHA-256 is
`a68bf0ccbb33b93d26f337e6d9abd9ce9d2ca29711083e6fdac0597e297f4a04`.
