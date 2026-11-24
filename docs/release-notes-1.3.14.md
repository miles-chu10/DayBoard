# DayBoard 1.3.14 — Faster launches and What's New

DayBoard 1.3.14 shows your last dashboard as soon as it opens, tells you what changed after each
update, and stops a burst of calendar changes from looking like lost Google access.

## New

- **Your dashboard shows up right away.** When you open DayBoard, it shows the tasks, reminders,
  mail and events it had last time, then refreshes them. A line at the top says
  **Showing what DayBoard had at** a time until the refresh finishes. The saved copy belongs to
  your account: it is dropped when you sign out or switch accounts, expires after three days, and
  never includes tokens, mail bodies or AI chats (#184).
- **What's New after each update.** The first time you open a new version, DayBoard shows what
  changed. Open it again any time from **Help → What's New in DayBoard** or
  **Settings → Updates → What's New** (#184).

## Fixed

- **"Google is busy" instead of "Primary calendar only".** Turning several calendars on and off
  quickly could use up Google's per-minute limit. DayBoard read that as missing access, showed
  **Primary calendar only, Reconnect** in Settings and fell back to your primary calendar. It now
  waits and retries, keeps your calendars, and says **Google is busy right now** if Google still
  needs a minute (#180).
- **Fewer reloads when you change settings.** A quick run of changes in Settings now refreshes the
  dashboard and meeting alerts once instead of once per change (#180).

## Changed

- The Inbox subtitle shows only your message counts, without "Gmail" in front (#184).

## Updating

- **Gmail needs an app password since 1.3.10.** If your inbox shows **Connect Gmail**, open
  **Settings → Sources → Gmail → Connect Gmail**, make an app password in your Google account and
  paste it in.
- Your data, sign-ins, trial and license stay where they are.

Apple Silicon, macOS 14+. AI and MCP remain optional.

Questions: support@getdayboard.com.
