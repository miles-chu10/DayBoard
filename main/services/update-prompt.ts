import type {
  AppUpdateState,
  UpdatePreferences,
  UpdateWindowState,
} from "../../shared/app-updates.js";

export interface UpdatePromptOptions {
  updates: {
    status(): AppUpdateState;
    check(): Promise<AppUpdateState>;
    download(): Promise<AppUpdateState>;
    install(): Promise<AppUpdateState>;
  };
  preferences: {
    read(): Promise<UpdatePreferences>;
    update(change: (value: UpdatePreferences) => UpdatePreferences): Promise<UpdatePreferences>;
  };
  window: {
    /** Opens the update window, or brings it forward and resizes it for `state.mode`. */
    show(state: UpdateWindowState): void;
    close(): void;
    isOpen(): boolean;
  };
}

/**
 * Decides when the update window appears and carries out its buttons. Background checks offer
 * each version once per launch unless it was skipped; Check for Updates… always shows the result.
 */
export function createUpdatePrompt(options: UpdatePromptOptions) {
  const offered = new Set<string>();
  let current: UpdateWindowState | null = null;
  let manualCheck = false;

  async function show(mode: UpdateWindowState["mode"], version: string | null) {
    current = { mode, version, preferences: await options.preferences.read() };
    if (version && mode === "prompt") offered.add(version);
    options.window.show(current);
  }

  /** For the background cycle: true downloads silently, false leaves the choice to the window. */
  async function shouldDownloadAutomatically(version: string): Promise<boolean> {
    const preferences = await options.preferences.read();
    if (preferences.skippedVersion === version) return false;
    if (preferences.automaticDownload) return true;
    if (!offered.has(version) && !options.window.isOpen()) await show("prompt", version);
    return false;
  }

  /** Follows the updater so the window reacts to background downloads and manual checks. */
  function onStateChange(state: AppUpdateState): void {
    const version = state.availableVersion;
    if (manualCheck && state.phase === "available" && version) {
      manualCheck = false;
      void show("prompt", version);
      return;
    }
    if (manualCheck && state.phase !== "checking") manualCheck = false;
    // A background download finished: offer it once, unless the window is already showing it.
    if (
      state.phase === "downloaded" &&
      version &&
      !offered.has(version) &&
      !options.window.isOpen()
    ) {
      void options.preferences.read().then((preferences) => {
        if (preferences.skippedVersion !== version) void show("prompt", version);
      });
    }
  }

  async function checkNow(): Promise<void> {
    const state = options.updates.status();
    if (["available", "downloaded"].includes(state.phase) && state.availableVersion) {
      await show("prompt", state.availableVersion);
      return;
    }
    await show("progress", null);
    if (state.phase === "unavailable") return;
    manualCheck = true;
    await options.updates.check();
  }

  async function installOnQuit(): Promise<void> {
    options.window.close();
    if (options.updates.status().phase === "available") await options.updates.download();
  }

  async function installNow(): Promise<AppUpdateState> {
    const state = options.updates.status();
    await show("progress", state.availableVersion);
    if (state.phase === "available") return options.updates.download();
    if (state.phase === "downloaded") return options.updates.install();
    return state;
  }

  async function skip(version: unknown): Promise<void> {
    const state = options.updates.status();
    // Once Squirrel.Mac holds a download it installs on quit, so that version can't be skipped.
    if (typeof version !== "string" || version !== state.availableVersion)
      throw new Error("That update is no longer offered.");
    if (state.phase !== "available") throw new Error("This update is already downloaded.");
    await options.preferences.update((value) => ({ ...value, skippedVersion: version }));
    options.window.close();
  }

  async function setAutomaticDownload(enabled: unknown): Promise<UpdatePreferences> {
    if (typeof enabled !== "boolean") throw new Error("Invalid setting.");
    const preferences = await options.preferences.update((value) => ({
      ...value,
      automaticDownload: enabled,
    }));
    if (current) current = { ...current, preferences };
    return preferences;
  }

  return {
    shouldDownloadAutomatically,
    onStateChange,
    checkNow,
    installOnQuit,
    installNow,
    skip,
    setAutomaticDownload,
    windowState: () => current,
    closed: () => {
      current = null;
      manualCheck = false;
    },
  };
}
