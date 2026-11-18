# DayBoard 1.3.10 — Gmail connects with an app password

DayBoard 1.3.10 connects Gmail the way Apple Mail does, with an app password from your Google
account, so signing in with Google now covers only Tasks and Calendar.

## Changed

- **Gmail now connects separately, with an app password.** Google sign-in no longer asks for access
  to your mail. Open **Settings → Sources → Gmail → Connect Gmail**, follow the three steps to make
  an app password in your Google account, and paste it in. Your inbox, replies, snoozes, follow-ups
  and unsubscribe work as before (#161).
- The app password is stored encrypted in your Mac's Keychain, and your mail goes straight between
  Gmail and your Mac. **Disconnect** in Settings deletes it, and signing out of Google disconnects
  Gmail too (#161).
- If Google stops accepting the app password, for example after you change your Google password,
  Gmail shows **Needs a new password** with a button to enter a new one (#161).

## Updating

- **If you already use Gmail in DayBoard,** your inbox shows **Connect Gmail** after this update.
  Add an app password once to bring it back. Tasks and Calendar keep working without signing in
  again.
- App passwords need 2-Step Verification on your Google account. Some work and school accounts
  don't allow them; ask your admin if Google says they aren't available.
- Your data, sign-ins, trial and license stay where they are.

Apple Silicon, macOS 14+. AI and MCP remain optional.

Questions: support@getdayboard.com.
