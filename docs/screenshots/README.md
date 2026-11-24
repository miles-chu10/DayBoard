# Screenshot gallery

Captured November 24, 2026 (Pacific) on a Mac from app source `232f072` (main after #184, the
code that ships as DayBoard 1.3.14; its package version still read 1.3.13), using the repository's
fictional demo fixtures. Captured with Node 26.

Each theme includes Home, the docked Assistant, Agenda, Calendar week/month, Tasks, Reminders,
Inbox, the full Assistant, Settings and the menu bar panel. Main windows are 1280×820 logical pixels, captured at
2560×1640 on a Retina display. Settings (1640×1416) and the menu bar panel (720×1240) use their own window sizes.

Regenerate on macOS with `npm run screenshots`. The script builds with `DAYBOARD_TEST=1`, creates
a disposable demo profile for each theme, checks that profile isolation is active, waits for
fictional data and the expected theme, then closes the demo apps. It does not connect personal
sources or make live AI requests. Copy the resulting PNGs to `website/assets/screens/` for the site.

The PNGs are direct screenshots, without compositing or altered interface content. They show
demo responses and do not establish live provider or account acceptance.
