export type AppUpdatePhase =
  | "unavailable"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "preparing"
  | "installing"
  | "error";

/** The complete, serializable state sent through the trusted DayBoard bridge. */
export interface AppUpdateState {
  phase: AppUpdatePhase;
  message: string;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  error: string | null;
}

export interface UpdatePreferences {
  /** Download updates in the background and install them on quit, without asking first. */
  automaticDownload: boolean;
  /** A version the person chose to skip; background checks don't offer it again. */
  skippedVersion: string | null;
}

/**
 * What the update window shows. "prompt" offers one version with its release notes; "progress" is
 * the compact window for Check for Updates… and Install and Relaunch.
 */
export interface UpdateWindowState {
  mode: "prompt" | "progress";
  version: string | null;
  preferences: UpdatePreferences;
}
