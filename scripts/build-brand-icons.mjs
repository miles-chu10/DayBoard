// Builds every DayBoard logo file from the geometry below: the SVG masters in brand/, their PNGs,
// app-icon.png, app-icon.icns, the menu-bar template images, the website icons and the copy of the
// header icon inside billing/src/assets.ts. Run with:
//   node scripts/build-brand-icons.mjs
// It renders in headless Chromium through Playwright (a devDependency), so it needs no macOS tool.
// Set DAYBOARD_CHROMIUM to a Chromium binary when Playwright's own browser isn't installed.
//
// The mark, "Sunbeam": four rows of a board, crossed by a diagonal beam of light. Where the beam
// falls, each row shows its source color: Tasks, Calendar, Reminders, Mail, top to bottom.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.join(import.meta.dirname, "..");
const out = (...parts) => path.join(root, ...parts);

const TILE = ["#23262f", "#0e0f14"];
const ROW = "#2f3342";
// The dark-theme source colors from renderer/theme.css, in row order.
const SOURCES = ["#0a84ff", "#30d158", "#ff9f0a", "#ff453a"];
// Horizontal run of the beam per unit of height: it leans 23° from vertical.
const SLOPE = 350 / 824;

const n = (value) => Number(value.toFixed(1));

// Apple-style squircle (superellipse, exponent 5) filling the 824 px body of the 1024 grid.
function squircle(center = 512, radius = 412) {
  const points = [];
  for (let i = 0; i < 240; i++) {
    const angle = (i / 240) * Math.PI * 2;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const x = center + radius * Math.sign(cos) * Math.abs(cos) ** 0.4;
    const y = center + radius * Math.sign(sin) * Math.abs(sin) ** 0.4;
    points.push(`${n(x)},${n(y)}`);
  }
  return `M${points.join("L")}Z`;
}

// The rows and their lit segments. `beam` is the beam's left edge at y = 512 and its width.
function rows({ x, width, top, height, gap, radius, beam }) {
  const base = [];
  const lit = [];
  SOURCES.forEach((color, index) => {
    const y = top + index * (height + gap);
    base.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${ROW}"/>`,
    );
    const left = (at) => beam.left - (at - 512) * SLOPE;
    const points = [
      [left(y), y],
      [left(y) + beam.width, y],
      [left(y + height) + beam.width, y + height],
      [left(y + height), y + height],
    ];
    lit.push(
      `<polygon points="${points.map(([px, py]) => `${n(px)},${n(py)}`).join(" ")}" fill="${color}"/>`,
    );
  });
  return { base: base.join(""), lit: lit.join("") };
}

const gradient = `<linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TILE[0]}"/><stop offset="1" stop-color="${TILE[1]}"/></linearGradient>`;
const svg = (body, viewBox = "0 0 1024 1024") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${viewBox}">\n${body}\n</svg>\n`;

// The full master, for 64 px and larger: the faint beam shows across the whole tile.
function mainMaster() {
  const art = rows({
    x: 252,
    width: 520,
    top: 287,
    height: 78,
    gap: 46,
    radius: 20,
    beam: { left: 385, width: 260 },
  });
  const shape = squircle();
  return svg(`<defs>${gradient}
<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".28"/></filter>
<clipPath id="body"><path d="${shape}"/></clipPath></defs>
<path d="${shape}" fill="url(#tile)" filter="url(#shadow)"/>
<g clip-path="url(#body)">${art.base}
<polygon points="${n(385 + 412 * SLOPE)},100 ${n(645 + 412 * SLOPE)},100 ${n(645 - 412 * SLOPE)},924 ${n(385 - 412 * SLOPE)},924" fill="#fff" opacity=".07"/>
${art.lit}</g>
<path d="${shape}" fill="none" stroke="#fff" stroke-opacity=".10" stroke-width="4"/>`);
}

// The small master, for 32 px and smaller: heavier rows, wider gaps and no faint beam.
const SMALL_ROWS = {
  x: 212,
  width: 600,
  top: 232,
  height: 104,
  gap: 48,
  radius: 22,
  beam: { left: 362, width: 300 },
};
// The squircle fills the 824 px body of the grid; BODY crops the transparent margin away.
const BODY = "100 100 824 824";
function smallMaster(viewBox) {
  const art = rows(SMALL_ROWS);
  const shape = squircle();
  return svg(
    `<defs>${gradient}</defs>
<path d="${shape}" fill="url(#tile)"/>
${art.base}
${art.lit}`,
    viewBox,
  );
}

// The small art on a full-bleed square, for the website header, which rounds the corners in CSS.
function siteTile() {
  const art = rows(SMALL_ROWS);
  return svg(
    `<defs>${gradient}</defs>
<rect x="100" y="100" width="824" height="824" fill="url(#tile)"/>
${art.base}
${art.lit}`,
    BODY,
  );
}

// Full-bleed square for surfaces that apply their own mask.
function squareMaster() {
  const art = rows({
    x: 222,
    width: 580,
    top: 262,
    height: 87,
    gap: 51,
    radius: 22,
    beam: { left: 367, width: 290 },
  });
  return svg(`<defs>${gradient}</defs>
<rect width="1024" height="1024" fill="url(#tile)"/>
${art.base}
<polygon points="${n(367 + 512 * SLOPE)},0 ${n(657 + 512 * SLOPE)},0 ${n(657 - 512 * SLOPE)},1024 ${n(367 - 512 * SLOPE)},1024" fill="#fff" opacity=".07"/>
${art.lit}`);
}

// The menu-bar glyph on a 16 px grid: four 2 px rows, 2 px apart, cut by the beam as a gap.
// Drawn in black; macOS tints template images, so only the alpha channel matters.
function menuBarMaster() {
  const pieces = [];
  for (const y of [1, 5, 9, 13]) {
    const center = (at) => 8 - (at - 8) * SLOPE;
    const half = 1.15;
    pieces.push(
      `<polygon points="1,${y} ${n(center(y) - half)},${y} ${n(center(y + 2) - half)},${y + 2} 1,${y + 2}"/>`,
      `<polygon points="${n(center(y) + half)},${y} 15,${y} 15,${y + 2} ${n(center(y + 2) + half)},${y + 2}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="#000">\n${pieces.join("\n")}\n</svg>\n`;
}

// --- ICNS -------------------------------------------------------------------------------------

// The 16 and 32 px entries are stored as "ARGB": four channel planes, each run-length encoded.
function packChannel(bytes) {
  const packed = [];
  let index = 0;
  while (index < bytes.length) {
    let run = 1;
    while (index + run < bytes.length && run < 130 && bytes[index + run] === bytes[index]) run++;
    if (run >= 3) {
      packed.push(run + 125, bytes[index]);
      index += run;
      continue;
    }
    const start = index;
    while (index < bytes.length && index - start < 128) {
      const next = bytes[index];
      if (bytes[index + 1] === next && bytes[index + 2] === next) break;
      index++;
    }
    packed.push(index - start - 1, ...bytes.slice(start, index));
  }
  return Buffer.from(packed);
}

function argbEntry(rgba) {
  const plane = (offset) => packChannel(rgba.filter((_, index) => index % 4 === offset));
  return Buffer.concat([Buffer.from("ARGB"), plane(3), plane(0), plane(1), plane(2)]);
}

function icns(entries) {
  const chunks = entries.map(([type, data]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

// --- Render -----------------------------------------------------------------------------------

const masters = {
  main: mainMaster(),
  small: smallMaster(),
  square: squareMaster(),
  menuBar: menuBarMaster(),
};
fs.writeFileSync(out("brand", "dayboard-icon.svg"), masters.main);
fs.writeFileSync(out("brand", "dayboard-icon-small.svg"), masters.small);
fs.writeFileSync(out("brand", "dayboard-icon-square.svg"), masters.square);
fs.writeFileSync(out("brand", "dayboard-menubar.svg"), masters.menuBar);

const browser = await chromium.launch({ executablePath: process.env.DAYBOARD_CHROMIUM });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function show(source, size) {
  await page.setViewportSize({ width: size, height: size });
  const uri = `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
  await page.setContent(
    `<body style="margin:0;background:transparent"><img src="${uri}" width="${size}" height="${size}" style="display:block">`,
  );
  await page.locator("img").evaluate((image) => image.decode());
}

async function png(source, size, { opaque = false } = {}) {
  await show(source, size);
  return page.screenshot({ omitBackground: !opaque, type: "png" });
}

async function pixels(source, size) {
  await show(source, size);
  return page.locator("img").evaluate((image, edge) => {
    const canvas = image.ownerDocument.createElement("canvas");
    canvas.width = canvas.height = edge;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, edge, edge);
    return [...context.getImageData(0, 0, edge, edge).data];
  }, size);
}

const main1024 = await png(masters.main, 1024);
fs.writeFileSync(out("brand", "dayboard-icon-1024.png"), main1024);
fs.writeFileSync(out("app-icon.png"), main1024);
fs.writeFileSync(out("brand", "dayboard-icon-small-1024.png"), await png(masters.small, 1024));
fs.writeFileSync(
  out("brand", "dayboard-icon-square-1024.png"),
  await png(masters.square, 1024, { opaque: true }),
);

fs.writeFileSync(
  out("app-icon.icns"),
  icns([
    ["ic04", argbEntry(await pixels(masters.small, 16))],
    ["ic05", argbEntry(await pixels(masters.small, 32))],
    ["ic11", await png(masters.small, 32)],
    ["ic12", await png(masters.main, 64)],
    ["ic07", await png(masters.main, 128)],
    ["ic13", await png(masters.main, 256)],
    ["ic08", await png(masters.main, 256)],
    ["ic14", await png(masters.main, 512)],
    ["ic09", await png(masters.main, 512)],
    ["ic10", main1024],
  ]),
);

const tray = out("main", "system-panels", "assets");
fs.writeFileSync(path.join(tray, "trayTemplate.png"), await png(masters.menuBar, 16));
fs.writeFileSync(path.join(tray, "trayTemplate@2x.png"), await png(masters.menuBar, 32));

const site = out("website", "assets");
fs.writeFileSync(path.join(site, "icon-32.png"), await png(smallMaster(BODY), 32));
fs.writeFileSync(path.join(site, "icon-96.png"), await png(siteTile(), 96, { opaque: true }));
fs.writeFileSync(path.join(site, "icon-180.png"), await png(masters.square, 180, { opaque: true }));

// The billing Worker serves its own copy of the website header icon to the buy and receipt pages.
const billingAssets = out("billing", "src", "assets.ts");
const encoded = fs.readFileSync(path.join(site, "icon-96.png")).toString("base64");
fs.writeFileSync(
  billingAssets,
  fs
    .readFileSync(billingAssets, "utf8")
    .replace(/(const ICON_PNG =\s*")[A-Za-z0-9+/=]+(")/, `$1${encoded}$2`),
);

await browser.close();
console.log("Wrote the brand masters, app icon, menu-bar images, website icons and billing icon.");
