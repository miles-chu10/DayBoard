# DayBoard logo

The mark is "Sunbeam": four rows of a board on a dark tile, crossed by a diagonal beam of light. Where the beam falls, each row shows its source color, top to bottom: Tasks blue `#0a84ff`, Calendar green `#30d158`, Reminders orange `#ff9f0a` and Mail red `#ff453a` (the dark-theme source colors in `renderer/theme.css`). The tile runs from `#23262f` to `#0e0f14` and the unlit rows are `#2f3342`.

| File                                                        | Use                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dayboard-icon.svg`, `dayboard-icon-1024.png`               | macOS app icon master: a squircle on Apple's 1024 grid (824 px body, 100 px margin, soft shadow) with the faint beam across the tile. Source of `app-icon.png` and of the 64 px and larger `app-icon.icns` sizes |
| `dayboard-icon-small.svg`, `dayboard-icon-small-1024.png`   | The same mark with heavier rows and no faint beam, for 32 px and smaller: the 16/32 `.icns` sizes, the favicon and the website header icon                                                                       |
| `dayboard-icon-square.svg`, `dayboard-icon-square-1024.png` | Full-bleed square for surfaces that apply their own mask: the Apple touch icon, social avatars and the Google OAuth consent-screen logo                                                                          |
| `dayboard-menubar.svg`                                      | The menu-bar glyph on a 16 px grid: the four rows in one color, with the beam as a diagonal gap. Source of `main/system-panels/assets/trayTemplate*.png`                                                         |

The SVGs are plain shapes with no embedded font.

## Regenerating

Run `node scripts/build-brand-icons.mjs`. The geometry and colors live in that script. It writes the four SVG masters, their PNGs, `app-icon.png`, `app-icon.icns`, the two menu-bar template images and the website's `icon-32.png`, `icon-96.png` and `icon-180.png`, rendering in headless Chromium through Playwright. It needs no macOS tool: the `.icns` container is written directly, with the 16 and 32 px entries from the small master and every larger size from the main master.

The Fraunces "D" with three dots was the mark until November 2026.
