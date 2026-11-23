# DayBoard 1.3.11 — A new menu bar, and your Mac calendars

DayBoard 1.3.11 rebuilds the menu bar panel so you can run your day from it without opening the
main window, adds the calendars from your Mac's Calendar app, such as iCloud, as a full calendar
source, and makes it easier to get DayBoard Pro from inside the app.

## New

- **The menu bar panel is now a day line.** Every event and to-do for the day sits on one line with
  a now marker, a seven-day strip to look at other days, your next meeting and mail waiting on you.
  Edit, move, check off or delete to-dos in place, edit or move events, and read mail, all without
  opening the main window. Moves show an **Undo** (#164).
- **Catch up** walks through overdue items one at a time: D marks done, 1 to 4 and 0 move, S skips.
  **Lists** and **Month** views sit beside the day view (⌘1, ⌘2, ⌘3), and one command bar adds an
  item (↩), asks the Assistant (⌘↩) or searches as you type (#164).
- **Mac calendars, such as iCloud, are now a full calendar source.** Open **Settings → Sources →
  Mac Calendars**, click **Allow Access**, and choose **Allow Full Access**. Each calendar has its own
  switch, and you can add, edit and delete events in them. No Google account needed (#167).
- **New events go to** in the same section picks where events you add are saved: Google Calendar,
  or any Mac calendar (#167).
- If a calendar from your Google account is also in the Calendar app, it starts hidden so meetings
  don't show twice. Subscribed calendars, such as holidays, are read-only (#167).
- **DayBoard Pro inside the app.** Home reminds you 3 days before the AI trial ends and on its last
  day, the sidebar trial counter opens a Pro card, and **Settings → License** leads with the offer,
  with key entry right below it. Pro is $5 until December 31, 2026, then $9 (#168).

## Fixed

- Updated the libraries behind DayBoard's local MCP server to fix reported security issues (#169).

## Updating

- **Gmail needs an app password since 1.3.10.** If your inbox shows **Connect Gmail**, open
  **Settings → Sources → Gmail → Connect Gmail**, make an app password in your Google account and
  paste it in. Tasks and Calendar keep working without signing in again.
- Mac calendars stay off until you allow access in **Settings → Sources → Mac Calendars**. DayBoard
  never asks for calendar access during the update.
- Your data, sign-ins, trial and license stay where they are.

Apple Silicon, macOS 14+. AI and MCP remain optional.

Questions: support@getdayboard.com.
