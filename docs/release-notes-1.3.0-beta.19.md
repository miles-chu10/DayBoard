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

DayBoard talks to the license service at `https://api.getdayboard.com` only to activate a key and
for the daily check. The trial is tracked on your Mac.

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
