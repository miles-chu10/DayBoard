import {
  isReleaseVersion,
  parseReleaseNotes,
  releaseNotesUrl,
  type ReleaseNotes,
} from "../../shared/release-notes.js";

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/**
 * Reads a published release's notes from its tag. Missing or unreadable notes resolve to null, so
 * the update window still offers the update. Successful reads are kept for the session.
 */
export function createReleaseNotesReader(options: { fetch?: Fetch; timeoutMs?: number } = {}) {
  const cache = new Map<string, ReleaseNotes>();
  const doFetch: Fetch = options.fetch ?? ((url, init) => fetch(url, init));

  return async function read(version: unknown): Promise<ReleaseNotes | null> {
    if (!isReleaseVersion(version)) throw new Error("Invalid DayBoard version.");
    const cached = cache.get(version);
    if (cached) return cached;
    try {
      const response = await doFetch(releaseNotesUrl(version), {
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (!response.ok) return null;
      const text = await response.text();
      if (text.length > 200_000) return null;
      const notes = parseReleaseNotes(version, text);
      if (!notes.sections.length && !notes.summary.length) return null;
      cache.set(version, notes);
      return notes;
    } catch {
      return null;
    }
  };
}
