import { app, ipcMain } from "../platform/index.js";
import { isAppStoreBuild } from "../../shared/app-store-build.js";
import { isDemoMode } from "../services/demo-data.js";
import { createAppUpdates, type UpdateClient } from "../services/app-updates.js";
import { createReleaseNotesReader } from "../services/release-notes.js";
import { updatePreferences } from "../services/update-preferences.js";
import { createUpdatePrompt } from "../services/update-prompt.js";
import { createUpdateWindowHost } from "../update-window.js";

export interface UpdateHandlerOptions {
  prepareForInstall: () => Promise<void>;
  resumeAfterInstallFailure: () => void;
}

export function registerUpdateHandlers(options: UpdateHandlerOptions) {
  // The prompt needs `updates`, and `updates` reports state changes to the prompt.
  const ref: { prompt?: ReturnType<typeof createUpdatePrompt> } = {};
  const updates = createAppUpdates({
    isOfficialRelease: !isAppStoreBuild && process.env.DAYBOARD_RELEASE === "1",
    isPackaged: app.isPackaged,
    isDemo: isDemoMode,
    currentVersion: app.getVersion(),
    ...(isAppStoreBuild
      ? { unavailableMessage: "The Mac App Store keeps DayBoard up to date." }
      : {}),
    loadUpdater: async () => {
      const module = await import("electron-updater");
      // electron-updater is CommonJS; this also works in the bundled ESM main process.
      const updater = module.autoUpdater ?? module.default?.autoUpdater;
      if (!updater) throw new Error("The update service is unavailable.");
      return updater as unknown as UpdateClient;
    },
    prepareForInstall: options.prepareForInstall,
    resumeAfterInstallFailure: options.resumeAfterInstallFailure,
    shouldDownloadAutomatically: (version) => ref.prompt!.shouldDownloadAutomatically(version),
    onChange: (state) => {
      ipcMain.broadcast("updates:changed", state);
      ref.prompt?.onStateChange(state);
    },
  });
  const host = createUpdateWindowHost({ onClosed: () => ref.prompt?.closed() });
  const prompt = createUpdatePrompt({ updates, preferences: updatePreferences, window: host });
  ref.prompt = prompt;
  const readReleaseNotes = createReleaseNotesReader();

  ipcMain.handle("updates:status", () => updates.status());
  ipcMain.handle("updates:check", () => updates.check());
  ipcMain.handle("updates:download", () => updates.download());
  ipcMain.handle("updates:install", () => updates.install());
  ipcMain.handle("updates:window", () => prompt.windowState());
  ipcMain.handle("updates:releaseNotes", (_event, version: unknown) => readReleaseNotes(version));
  ipcMain.handle("updates:installOnQuit", () => prompt.installOnQuit());
  ipcMain.handle("updates:installNow", () => prompt.installNow());
  ipcMain.handle("updates:skip", (_event, version: unknown) => prompt.skip(version));
  ipcMain.handle("updates:setAutomaticDownload", (_event, enabled: unknown) =>
    prompt.setAutomaticDownload(enabled),
  );
  ipcMain.handle("updates:closeWindow", () => host.close());
  ipcMain.handle("updates:preferences", () => updatePreferences.read());
  return Object.assign(updates, { checkNow: () => prompt.checkNow() });
}
