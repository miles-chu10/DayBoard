import { useQuery } from "@tanstack/react-query";
import { parseReleaseNotes, type ReleaseNotes } from "@shared/release-notes";

import { invoke } from "./ipc";

// Each build carries its own release notes, so What's New works offline and matches the
// version that is running. Notes are loaded only when What's New opens.
const BUNDLED = import.meta.glob<string>("../../docs/release-notes-*.md", {
  query: "?raw",
  import: "default",
});

export function bundledNotesPath(version: string): string {
  return `../../docs/release-notes-${version}.md`;
}

export async function loadWhatsNewNotes(version: string): Promise<ReleaseNotes | null> {
  const load = BUNDLED[bundledNotesPath(version)];
  if (load) {
    const notes = parseReleaseNotes(version, await load());
    if (notes.sections.length || notes.summary.length) return notes;
  }
  // A build without its notes file (a local build of main) asks the published release.
  return invoke<ReleaseNotes | null>("updates:releaseNotes", version).catch(() => null);
}

export interface WhatsNewState {
  version: string;
  /** True on the first dashboard launch after an update. */
  show: boolean;
}

export function useWhatsNewState() {
  return useQuery({
    queryKey: ["whats-new"],
    queryFn: () => invoke<WhatsNewState>("whatsNew:state"),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
