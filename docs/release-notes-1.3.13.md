# DayBoard 1.3.13 — A simpler sidebar and tidier Settings

DayBoard 1.3.13 makes the sidebar shorter, lays Settings out as a list of sections with one row per
setting, trims the task and reminder details, and renames Mac Calendars to iCloud Calendars.

## New

- **A simpler sidebar.** Each view is one line with its count. **Calendar**, **Tasks** and
  **Reminders** sit under **Agenda**, the view that combines them. A second line appears only when
  a source needs attention, such as a failed refresh. The line under your name shows only when
  something needs you, for example **Google needs sign-in** (#178).
- **Settings has a side list.** General, Sources, AI, MCP Servers, License and Updates are listed
  down the left, and each setting is one row with its label and description on the left and its
  control on the right (#178).
- **Tighter task and reminder details.** The details no longer repeat the source and list that the
  subtitle already shows (#178).
- **Mac Calendars is now iCloud Calendars** in Settings, the event editor and the website. Nothing
  about how those calendars work has changed (#178).

## Changed

- **⌃1–9 follow the sidebar from top to bottom.** With the default order, Inbox moved from ⌃4 to
  ⌃6, because Calendar, Tasks and Reminders now come before it under Agenda.
- **MCP Servers left the sidebar.** Manage them in **Settings → MCP Servers** or from the Assistant.
- The Assistant's model no longer shows in the sidebar. It is still in the Assistant's composer and
  in **Settings → AI**.

## Fixed

- **Settings → General → Sidebar** lists the views the way the sidebar draws them, with Calendar,
  Tasks and Reminders under Agenda, so every press of the up and down arrows moves a view.

## Updating

- **Gmail needs an app password since 1.3.10.** If your inbox shows **Connect Gmail**, open
  **Settings → Sources → Gmail → Connect Gmail**, make an app password in your Google account and
  paste it in.
- Your data, sign-ins, trial and license stay where they are.

Apple Silicon, macOS 14+. AI and MCP remain optional.

Questions: support@getdayboard.com.
