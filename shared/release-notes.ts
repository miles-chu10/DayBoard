// Parses the Markdown release notes in docs/release-notes-<version>.md into plain data. The app's
// update window and the website's /changelog page both render this, so they always match.

export type ReleaseNoteInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type ReleaseNoteSectionKind = "new" | "fixed" | "other";

export interface ReleaseNoteSection {
  kind: ReleaseNoteSectionKind;
  title: string;
  /** Paragraphs that come before the section's list. */
  paragraphs: ReleaseNoteInline[][];
  items: ReleaseNoteInline[][];
}

export interface ReleaseNotes {
  version: string;
  /** The text after the version in the first heading, such as "One-line Inbox rows". */
  subtitle: string | null;
  summary: ReleaseNoteInline[][];
  sections: ReleaseNoteSection[];
}

/** Sections written for whoever publishes the release, not for people using DayBoard. */
const INTERNAL_SECTION = /^(before publishing|release verification|under the hood)\b/i;

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

export function isReleaseVersion(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && VERSION.test(value);
}

export function isPrerelease(version: string): boolean {
  return version.includes("-");
}

/** "1.3.0-beta.22" → "1.3.0 beta 22"; "1.3.0" stays as it is. */
export function displayVersion(version: string): string {
  return version.replace(/-([a-z]+)\.?(\d+)?$/i, (_m, label: string, n?: string) =>
    n ? ` ${label} ${n}` : ` ${label}`,
  );
}

export function sectionKind(title: string): ReleaseNoteSectionKind {
  if (/^(new|added|what'?s new|features?|new features?)\b/i.test(title)) return "new";
  if (/^(fixe[sd]|bug ?fixes|fixed)\b/i.test(title)) return "fixed";
  return "other";
}

export function sectionTitle(section: Pick<ReleaseNoteSection, "kind" | "title">): string {
  if (section.kind === "new") return "New features";
  if (section.kind === "fixed") return "Bug fixes";
  return section.title;
}

/** Bold, code and links; anything else stays literal text. */
export function parseInline(source: string): ReleaseNoteInline[] {
  const result: ReleaseNoteInline[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) result.push({ kind: "text", text: source.slice(last, index) });
    if (match[1] !== undefined) result.push({ kind: "strong", text: match[1] });
    else if (match[2] !== undefined) result.push({ kind: "code", text: match[2] });
    else result.push({ kind: "link", text: match[3]!, href: match[4]! });
    last = index + match[0].length;
  }
  if (last < source.length) result.push({ kind: "text", text: source.slice(last) });
  return result;
}

export function inlineText(parts: readonly ReleaseNoteInline[]): string {
  return parts.map((part) => part.text).join("");
}

/** Accepts the note files' Markdown subset: `#`/`##` headings, paragraphs and `-` lists. */
export function parseReleaseNotes(version: string, markdown: string): ReleaseNotes {
  const notes: ReleaseNotes = { version, subtitle: null, summary: [], sections: [] };
  let section: ReleaseNoteSection | null = null;
  let block: { type: "paragraph" | "item"; lines: string[] } | null = null;

  const flush = () => {
    if (!block) return;
    const inline = parseInline(block.lines.join(" ").replace(/\s+/g, " ").trim());
    if (block.type === "item") {
      if (!section) {
        section = { kind: "other", title: "Changes", paragraphs: [], items: [] };
        notes.sections.push(section);
      }
      section.items.push(inline);
    } else if (section) section.paragraphs.push(inline);
    else notes.summary.push(inline);
    block = null;
  };

  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const text = heading[2]!.trim();
      if (heading[1] === "#") {
        const subtitle = /\s[—–-]\s(.+)$/.exec(text);
        notes.subtitle = subtitle ? subtitle[1]!.trim() : null;
      } else {
        section = { kind: sectionKind(text), title: text, paragraphs: [], items: [] };
        notes.sections.push(section);
      }
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      flush();
      block = { type: "item", lines: [item[1]!] };
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (block) block.lines.push(line.trim());
    else block = { type: "paragraph", lines: [line.trim()] };
  }
  flush();
  notes.sections = notes.sections.filter(
    (s) => !INTERNAL_SECTION.test(s.title) && (s.items.length || s.paragraphs.length),
  );
  return notes;
}

/** Where a published release's notes live: the docs file at that release's tag. */
export function releaseNotesUrl(version: string): string {
  return `https://raw.githubusercontent.com/miles-chu10/dayboard/v${version}/docs/release-notes-${version}.md`;
}

export const CHANGELOG_URL = "https://getdayboard.com/changelog";
