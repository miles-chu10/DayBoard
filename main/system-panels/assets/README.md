# Menu-bar icon

`trayTemplate.png` (16 × 16) and `trayTemplate@2x.png` (32 × 32) are macOS template images: the
four rows of the DayBoard mark in black on a transparent background, with the beam as a diagonal
gap, drawn from `brand/dayboard-menubar.svg`. They are kept beside `tray.ts` so electron-vite copies them into the build (files under `resources/` would not ship inside `app.asar`). macOS tints them for light and dark menu bars.

Regenerate with `node scripts/build-brand-icons.mjs`, which builds every logo file.
