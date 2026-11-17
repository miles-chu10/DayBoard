// Builds website/changelog.html from docs/changelog.json and docs/release-notes-<version>.md, using
// website/download.html for the page's header and footer. Run `npm run changelog` after adding a
// release; tests/website-changelog.test.mjs fails while the committed page is out of date.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  displayVersion,
  isPrerelease,
  isReleaseVersion,
  parseReleaseNotes,
  sectionTitle,
  type ReleaseNoteInline,
  type ReleaseNotes,
} from "../shared/release-notes.js";

export interface ChangelogRelease {
  version: string;
  date: string;
  image?: { light: string; dark: string; alt: string };
}

const ICONS = {
  new: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" />',
  fixed:
    '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5Z" />',
  other: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />',
} as const;

function escape(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function inline(parts: readonly ReleaseNoteInline[]): string {
  return parts
    .map((part) => {
      if (part.kind === "strong") return `<strong>${escape(part.text)}</strong>`;
      if (part.kind === "code") return `<code>${escape(part.text)}</code>`;
      if (part.kind === "link") return `<a href="${escape(part.href)}">${escape(part.text)}</a>`;
      return escape(part.text);
    })
    .join("");
}

export function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function icon(kind: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[kind]}</svg>`;
}

function hero(release: ChangelogRelease, notes: ReleaseNotes): string {
  if (release.image) {
    const { light, dark, alt } = release.image;
    return `<figure class="release-shot theme-picture">
            <img class="theme-light" src="${escape(light)}" alt="${escape(alt)}" width="2560" height="1640" loading="lazy" />
            <img class="theme-dark" src="${escape(dark)}" alt="${escape(alt)}" width="2560" height="1640" loading="lazy" />
          </figure>`;
  }
  return `<div class="release-card" aria-hidden="true">
            <img src="assets/icon-180.png" alt="" width="72" height="72" />
            <span class="release-card-name">DayBoard ${escape(displayVersion(release.version))}</span>
            ${notes.subtitle ? `<span class="release-card-sub">${escape(notes.subtitle)}</span>` : ""}
          </div>`;
}

function article(release: ChangelogRelease, notes: ReleaseNotes): string {
  const id = `v${release.version}`;
  const beta = isPrerelease(release.version);
  const summary = notes.summary.map((p) => `<p>${inline(p)}</p>`).join("\n            ");
  const sections = notes.sections
    .map((section) => {
      const paragraphs = section.paragraphs.map((p) => `<p>${inline(p)}</p>`).join("");
      const items = section.items.length
        ? `<ul>${section.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`
        : "";
      return `<section class="release-section release-${section.kind}">
              <h3>${icon(section.kind)}${escape(sectionTitle(section))}</h3>
              ${paragraphs}${items}
            </section>`;
    })
    .join("\n            ");
  return `<article class="release" id="${escape(id)}" aria-labelledby="${escape(id)}-title">
        <div class="release-meta">
          <p class="release-date">
            <span class="release-dot${beta ? "" : " is-stable"}" aria-hidden="true"></span>
            <time datetime="${escape(release.date)}">${escape(formatDate(release.date))}</time>
            ${beta ? '<span class="release-badge">Beta</span>' : '<span class="release-badge is-stable">Release</span>'}
          </p>
          <h2 id="${escape(id)}-title"><a href="#${escape(id)}">DayBoard ${escape(displayVersion(release.version))}</a></h2>
          ${beta ? `<p class="release-version"><code>${escape(release.version)}</code></p>` : ""}
          ${release.image && notes.subtitle ? `<p class="release-subtitle">${escape(notes.subtitle)}</p>` : ""}
        </div>
        <div class="release-body">
          ${hero(release, notes)}
          <div class="release-notes">
            ${summary}
            ${sections}
            <p class="release-links"><a href="https://github.com/miles-chu10/DayBoard/releases/tag/v${escape(release.version)}">GitHub release and checksums</a></p>
          </div>
        </div>
      </article>`;
}

export function buildChangelogPage(options: {
  shell: string;
  releases: readonly ChangelogRelease[];
  readNotes: (version: string) => string;
}): string {
  const articles = options.releases.map((release) => {
    if (!isReleaseVersion(release.version)) throw new Error(`Bad version ${release.version}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(release.date))
      throw new Error(`Bad date for ${release.version}`);
    return article(release, parseReleaseNotes(release.version, options.readNotes(release.version)));
  });
  const main = `<main id="main">
      <header class="page-head">
        <div class="wrap">
          <span class="eyebrow">Changelog</span>
          <h1>What’s new in <em>DayBoard.</em></h1>
          <p>
            Every DayBoard release, newest first. These are the same notes DayBoard shows when it
            offers you an update.
          </p>
        </div>
      </header>

      <div class="wrap changelog">
      ${articles.join("\n\n      ")}
      </div>
    </main>`;

  let page = options.shell;
  const replace = (pattern: RegExp, value: string) => {
    if (!pattern.test(page)) throw new Error(`Shell is missing ${pattern}`);
    page = page.replace(pattern, value);
  };
  replace(/<title>[^<]*<\/title>/, "<title>Changelog — DayBoard</title>");
  replace(
    /(<meta\s+name="description"\s+content=")[^"]*(")/,
    "$1Release notes for every DayBoard version: new features and bug fixes, newest first.$2",
  );
  replace(/(<link rel="canonical" href=")[^"]*(")/, "$1https://getdayboard.com/changelog$2");
  replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, "$1DayBoard changelog$2");
  replace(
    /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
    "$1Every DayBoard release, newest first.$2",
  );
  replace(
    /(<meta\s+property="og:url"\s+content=")[^"]*(")/,
    "$1https://getdayboard.com/changelog$2",
  );
  replace(/ aria-current="page"/, "");
  replace(
    /(<a class="nav-link" href="changelog\.html")(>Changelog<\/a>)/,
    '$1 aria-current="page"$2',
  );
  replace(/<main id="main">[\s\S]*<\/main>/, main);
  return page;
}

if (import.meta.url.startsWith("file:") && process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("..", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");
  const { releases } = JSON.parse(read("docs/changelog.json")) as {
    releases: ChangelogRelease[];
  };
  const page = buildChangelogPage({
    shell: read("website/download.html"),
    releases,
    readNotes: (version) => read(`docs/release-notes-${version}.md`),
  });
  writeFileSync(new URL("website/changelog.html", root), page);
  console.log(`Wrote website/changelog.html with ${releases.length} releases.`);
}
