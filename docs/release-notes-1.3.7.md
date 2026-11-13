# DayBoard 1.3.7 — Quick add works without waiting on AI

DayBoard 1.3.7 fixes AI features for people whose Codex sign-in is kept in the macOS Keychain, and
lets the menu bar add a to-do to a list you picked even when AI can't help.

## Fixed

- AI features no longer say **Codex isn't signed in** when your Codex login is stored in the macOS
  Keychain. DayBoard now uses the same login store Codex itself uses (#147).
- When you pick a Google Tasks or Apple Reminders list in menu-bar quick add, DayBoard adds the
  line as you typed it if AI is unavailable, locked or fails, instead of stopping with an error.
  **Let AI decide** still asks AI and opens the form if it can't (#147).

## Updating

- **From 1.3.2,** DayBoard shows the Software Update window with these notes before it installs.
- Your data, sign-ins, trial and license stay where they are.

Apple Silicon, macOS 14+. AI and MCP remain optional.

Questions: support@getdayboard.com.
