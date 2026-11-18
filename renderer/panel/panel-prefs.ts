/** What this panel shows. Kept on this Mac, apart from the app-wide source settings. */
export interface PanelPrefs {
  calendar: boolean;
  tasks: boolean;
  reminders: boolean;
  mail: boolean;
  /** Keep to-dos checked off today on the day's line. */
  completed: boolean;
}

export const DEFAULT_PREFS: PanelPrefs = {
  calendar: true,
  tasks: true,
  reminders: true,
  mail: true,
  completed: false,
};

/** Stored preferences with anything missing or malformed back at its default. */
export function normalizePrefs(value: unknown): PanelPrefs {
  const stored =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_PREFS).map(([key, fallback]) => [
      key,
      typeof stored[key] === "boolean" ? stored[key] : fallback,
    ]),
  ) as unknown as PanelPrefs;
}
