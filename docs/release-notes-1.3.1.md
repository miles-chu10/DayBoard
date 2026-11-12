# DayBoard 1.3.1 — See what's new before you update

DayBoard 1.3.1 brings back a Software Update window that shows each version's release notes
before it installs. It also keeps the day's earlier meetings in the menu bar, makes the columns
in the main window easier to resize, and has a new icon.

## New

- **An update window with release notes.** When DayBoard finds a new version it now asks first
  and shows what changed, with Skip This Version, Install on Quit and Install and Relaunch.
  DayBoard → Check for Updates… shows its progress in the same window: checking, downloading,
  ready to install, or up to date (#127).
- **Choose how updates arrive.** Settings → Updates → Download and install updates automatically
  downloads updates in the background and installs them when you quit. When it is off, DayBoard
  asks first. The update window has the same switch (#127).
- **A changelog on the website.** [getdayboard.com/changelog](https://getdayboard.com/changelog)
  lists every release with its notes (#127).
- **Earlier meetings stay in the menu bar.** The menu-bar panel lists all of today's events in
  order. Meetings that have ended turn gray and no longer disappear, and an event is never cut to
  make room for to-dos (#125).
- **Easier column resizing.** The dividers beside the sidebar and the side panel highlight when
  you point at them and while you drag. Double-click a divider to return its column to the default
  width (#124).
- **Grok replaces Muse under subscription accounts.** Settings → AI → Subscription accounts now
  lists Grok, which uses a SuperGrok or X subscription through xAI's Grok Build CLI (`grok login`).
  Grok answers questions only and does not use MCP servers. Muse is no longer listed; if you had
  picked it, DayBoard goes back to the default and asks you to choose again (#128).
- **A new icon.** DayBoard has a new Sunbeam icon in the Dock, in Finder and on the website. The
  menu bar icon is now in color (#121).
- **Clearer Google sign-in.** The sign-in button follows Google's branding, and DayBoard shows what
  data it reads before every Google sign-in. If a permission was left unticked on Google's screen,
  the affected feature says **Google Permission Needed** and asks you to sign in again (#122).
- **A confirmation before AI turns on.** Settings and the welcome flow ask you to confirm before
  the AI features are switched on (#122).

## Updating

- **From 1.3.0,** DayBoard updates itself to 1.3.1 the way it did before: it downloads the update
  in the background and shows **Restart to update** in the toolbar. The new update window is part
  of 1.3.1, so you'll see it from the next update on.
- Your data, sign-ins, trial and license stay where they are.

Apple Silicon, macOS 14+. AI and MCP remain optional.

Questions: support@getdayboard.com.
