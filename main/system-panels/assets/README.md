# Menu-bar icon

`tray.png` (16 × 16) and `tray@2x.png` (32 × 32) are the DayBoard mark for the menu bar, drawn from
`brand/dayboard-menubar-color.svg`: four gray rows on a transparent background, with the beam
lighting each row in its source color. They are color images, not macOS template images, so the
menu bar shows them as drawn; the gray is chosen to read on light and dark menu bars. Their names
must not end in `Template`, which would make macOS tint them. They are kept beside `tray.ts` so
electron-vite copies them into the build (files under `resources/` would not ship inside
`app.asar`).

Regenerate with `node scripts/build-brand-icons.mjs`, which builds every logo file.
