import { isReleaseVersion } from "../../shared/release-notes.js";

export interface WhatsNewRecord {
  /** The newest version whose What's New was shown or deliberately skipped. */
  seenVersion: string | null;
}

export function parseWhatsNew(value: unknown): WhatsNewRecord {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { seenVersion: isReleaseVersion(record.seenVersion) ? record.seenVersion : null };
}

/**
 * Whether this launch follows an update. A new install sees the welcome instead, and records its
 * first version so only later updates show What's New. An install from before this record
 * existed has finished or skipped the welcome, so its first launch here is an update.
 */
export function whatsNewDecision(input: {
  current: string;
  seen: string | null;
  onboarded: boolean;
  demo: boolean;
}): { show: boolean; record: string | null } {
  if (input.demo || input.seen === input.current) return { show: false, record: null };
  if (input.seen === null && !input.onboarded) return { show: false, record: input.current };
  return { show: true, record: null };
}
