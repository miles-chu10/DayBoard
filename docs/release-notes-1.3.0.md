# DayBoard 1.3.0

DayBoard 1.3.0 is the official release that follows the 1.3.0 betas. Compared with 1.2.0 it adds
a Home page, mail you can triage, write and snooze, an Assistant beside every page, Quick Capture,
a menu-bar agenda, Notes and tabs. It is also the first official release that is signed with
DayBoard's Developer ID, notarized by Apple and able to update itself, and the first with DayBoard
Pro.

It is the same code as 1.3.0-beta.22, with only the version number changed. The beta notes
(beta.12 through beta.22) have the detail behind each item below.

## New

- **Home.** DayBoard opens on a greeting and a one-line summary, the mail and follow-ups waiting
  on you, tasks suggested from your mail, and one Agenda card for Today or This week. Overdue
  items fold into a single row that remembers whether you left it open. The Agenda keeps its own
  sidebar row.
- **Mail you can work through.** New mail is sorted into needs reply, FYI and ignorable, with a
  chip on every row. Inbox rows fit on one line, with Reply, Add task, Archive and Open in Gmail
  on hover (Settings → General → Inbox rows → With preview keeps the three-line rows). You can
  write and send mail with a 5-second Undo, snooze an email, ask to be reminded if nobody
  replies, and unsubscribe from newsletters in one click where the sender supports it.
- **Notifications and a Dock badge** for snoozes that come back, unanswered follow-ups and,
  if you choose, new mail. Notifications start off. Both are in Settings → General → Mail.
- **The Assistant beside any page** (⌥⌘J). It knows which email, event or to-do you have open.
  The composer has a model chip with a per-provider effort setting, `/` commands and `@` mentions
  of your tasks, events and mail.
- **⌘K.** Jump to any view, email, event, to-do or note, or run an action.
- **Quick Capture.** ⌃⌥⇧Space (changeable in Settings) opens a small panel over any app. Type a
  thought and press Enter, and it is filed in Google Tasks, Apple Reminders or Google Calendar,
  with Undo.
- **Menu-bar agenda.** A menu-bar icon opens today's items, the next meeting, the mail that needs
  you, a collapsible overdue row and a capture box.
- **Up Next.** A card for the next meeting with a Join button and AI meeting prep, and an
  optional notification before it starts. With a Granola MCP server set up, you can pull that
  meeting's notes afterwards and turn their action items into Tasks or Reminders.
- **Notes.** Markdown notes with live preview, found with ⌘K. An Assistant chat can be saved as
  a note.
- **Memory.** Tell DayBoard your preferences in Settings → AI. The Assistant and reply drafts
  follow them. A preference suggested from your edits is saved only when you pick Remember.
- **Tabs and your own sidebar.** ⌘T opens a tab and your tabs come back next time. Reorder the
  sidebar views, hide any but Home, and turn off the count pills in Settings → General → Sidebar.
- **Keyboard.** ⌘N opens New Item from the main views, J/K, Return, E, R, S and C work in the
  Inbox, and ? shows every shortcut.
- **A welcome for new installs.** A four-step welcome covers what DayBoard is, connecting Google
  and Apple Reminders, choosing an AI tool (optional) and the shortcuts worth knowing. Every step
  can be skipped. Help → Welcome to DayBoard… opens it again.
- **Agent activity and usage.** Settings → MCP Servers lists the DayBoard tools the Assistant or
  an outside agent used in the last 30 days (names and outcomes only). Settings → AI shows the AI
  requests and tokens DayBoard recorded per day and model.
- **Send feedback from the app.** Help → Send Feedback… opens an email to
  support@getdayboard.com with your DayBoard and macOS versions filled in.

## DayBoard Pro

- **Free, with no license check:** Tasks, Gmail, Calendar, Reminders, sync and linking, notes,
  settings and the MCP server.
- **DayBoard Pro:** the Assistant, AI actions, dictation, AI parsing in Quick Capture and learned
  memories. Each Mac gets a 14-day trial that starts the first time you use one of them. After
  the trial only AI locks. Nothing you wrote is lost, and everything else keeps working.
- **To unlock Pro,** buy a key at [getdayboard.com/pricing.html](https://getdayboard.com/pricing.html),
  open Settings → License, paste the key and click Activate. A key works on up to 3 Macs.
  Settings → License → Deactivate this device asks before it frees a seat. Your key appears on the
  receipt page after you pay and isn't emailed, so save it right away.
- You still bring your own AI: Claude Code, Codex or an API key from your provider.

## Install and updates

- **Signed, notarized and self-updating.** The app and the disk image are signed with DayBoard's
  Developer ID and notarized by Apple. DayBoard checks for updates after launch and every few
  hours, downloads them in the background and shows **Restart to update** in the toolbar. If you
  don't restart, the update installs the next time you quit.
- **From 1.3.0-beta.12 or later,** DayBoard updates itself to 1.3.0. Your data, sign-ins, trial
  and license stay where they are. Once you are on 1.3.0, DayBoard offers official releases only,
  not betas.
- **From anything older than 1.3.0-beta.12,** download the DMG from
  [getdayboard.com/download](https://getdayboard.com/download), quit DayBoard and drag the new
  app into Applications. App data lives outside the app and is kept.

If updates never arrive, make sure DayBoard was dragged into Applications in Finder. A copy put
there another way can run from a read-only location where macOS won't let it replace itself.
Dragging it out of Applications and back in Finder once fixes this.

## Fixed

- Going offline no longer signs you out of Google. DayBoard shows a connection error with Retry
  and keeps you signed in.
- An open event editor no longer resets when the calendar refreshes in the background.
- Note text survives a failed save, and a deleted note doesn't come back.
- An email waiting in its Undo window is sent only from the Google account it was written in.
- Saves and a normal quit no longer stall while the Google sign-in browser tab is open.
- Google Calendar events that start and end at the same time show up in Agenda, Home and the
  menu bar, and no longer block planning slots.
- MCP clients reach DayBoard after a port clash without a relaunch, and a turned-off MCP server
  no longer looks like a rejected key.
- Long text stays in its row, Calendar "Focus on" works, and toasts are readable in dark mode.

## Privacy and security

- **An anonymous daily check-in.** Once a day, DayBoard tells its license service at
  `https://api.getdayboard.com` that it's in use. It sends a random ID made only for this, the
  DayBoard version, and whether you're in the AI trial or have Pro. It never sends your calendar,
  tasks, reminders, mail, AI chats, Google account or license key. Settings → Updates → **Send a
  daily anonymous check-in** turns it off. The
  [privacy policy](https://getdayboard.com/privacy.html#checkin) has the details.
- DayBoard also talks to the license service to activate or deactivate a key and for a daily key
  check. The trial is tracked on your Mac.
- Memories are saved on your Mac. The activity log keeps tool names and outcomes, never what a
  tool read or wrote.
- Electron 44.10.0 and updated bundled libraries, with the published security fixes listed in the
  beta.15 notes. The MCP SDK is 1.32.0, with input limits on DayBoard's local MCP servers.

Apple Silicon, macOS 14+. AI and MCP remain optional.

Questions: support@getdayboard.com.

## Release verification

Not yet released. This section is filled in from the signed release run and the published
assets.
