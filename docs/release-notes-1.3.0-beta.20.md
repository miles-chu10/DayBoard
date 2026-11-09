# DayBoard 1.3.0-beta.20 — Agenda on Home, a welcome for new installs and a daily check-in

This beta puts your agenda on Home, adds a short first-run welcome for new installs and an
anonymous daily check-in, so we know how many people use DayBoard. Licensing works as in beta.19:
everything that isn't AI is free, AI runs a 14-day trial on each Mac, and DayBoard Pro unlocks it
for good.

## New

- **A welcome for new installs.** A new install opens a four-step welcome: what DayBoard is,
  connecting Google and Apple Reminders, choosing an AI tool (optional), and the shortcuts worth
  knowing. Every step can be skipped. An example day on the right fills in as you connect
  accounts. It shows once. Help → Welcome to DayBoard… opens it again. If you already use
  DayBoard, updating doesn't show it (#98).
- **An anonymous daily check-in.** Once a day, DayBoard tells its license service at
  `https://api.getdayboard.com` that it's in use. It sends a random ID made only for this (not
  your license key or anything from your Mac's hardware), the DayBoard version, and whether
  you're in the AI trial or have Pro. It never sends your calendar, tasks, reminders, mail, AI
  chats, Google account or license key, and the service doesn't store your IP address. To turn
  it off, open Settings → Updates and switch off **Send a daily anonymous check-in**. The
  [privacy policy](https://getdayboard.com/privacy.html#checkin) has the details (#97).
- **Your agenda on Home.** Home now has one Agenda card in place of the separate tasks and
  meetings cards: overdue items, then events, tasks and reminders by day, for Today or This week
  (#101).

## Fixed

- **Google Calendar events that start and end at the same time show up everywhere.** Events like
  a 10:00–10:00 reminder appeared in Calendar and Up next but not in Agenda, Home or the menu bar.
  They now appear on the day they start (#101).

## Updating

From beta.12 or later, DayBoard downloads beta.20 in the background and shows **Restart to
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
