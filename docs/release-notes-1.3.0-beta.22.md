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

Not yet released. This section is filled in from the signed release run and the published
assets.
