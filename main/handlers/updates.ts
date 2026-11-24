import * as path from "node:path";

import { app, ipcMain } from "../platform/index.js";
import { isAppStoreBuild } from "../../shared/app-store-build.js";
import { isDemoMode } from "../services/demo-data.js";
import { createAppUpdates, type UpdateClient } from "../services/app-updates.js";
import { createReleaseNotesReader } from "../services/release-notes.js";
import { updatePreferences } from "../services/update-preferences.js";
import { createUpdatePrompt } from "../services/update-prompt.js";
import { createUpdateWindowHost } from "../update-window.js";
import { getSettings } from "../services/settings-store.js";
import { createJsonStore } from "../services/json-store.js";
import { parseWhatsNew, whatsNewDecision } from "../services/whats-new.js";
import { focusMainWindow, isMainRoute } from "../window.js";

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
  registerWhatsNewHandlers();
  return Object.assign(updates, { checkNow: () => prompt.checkNow() });
}

/** What's New: shown once in the dashboard after each update, and on request from Help or Settings. */
function registerWhatsNewHandlers() {
  const current = app.getVersion();
  const whatsNewStore = createJsonStore({
    path: () => path.join(app.getPath("userData"), "whats-new.json"),
    parse: parseWhatsNew,
  });
  ipcMain.handle("whatsNew:state", async () => {
    const [{ seenVersion }, settings] = await Promise.all([whatsNewStore.read(), getSettings()]);
    const decision = whatsNewDecision({
      current,
      seen: seenVersion,
      onboarded: settings.general.onboarded,
      demo: isDemoMode(),
    });
    if (decision.record) await whatsNewStore.update(() => ({ seenVersion: decision.record }));
    return { version: current, show: decision.show };
  });
  ipcMain.handle("whatsNew:seen", async (_event, version: unknown) => {
    if (version !== current) throw new Error("whatsNew:seen: not the running version");
    if (isDemoMode()) return;
    await whatsNewStore.update(() => ({ seenVersion: current }));
  });
  ipcMain.handle("whatsNew:open", async (_event, to: unknown) => {
    await focusMainWindow({ ...(isMainRoute(to) ? { to } : {}), whatsNew: true });
  });
}
