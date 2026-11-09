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
