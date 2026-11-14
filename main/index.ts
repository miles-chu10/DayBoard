import { app, dialog, logger } from "./platform/index.js";
import { registerHandlers } from "./handlers/index.js";
import { powerMonitor } from "electron";
import {
  acquireSingleInstanceLock,
  createMainWindow,
  focusMainWindow,
  getMainWindow,
  keepMainWindowLoadedWhile,
  setupApplicationMenu,
} from "./window.js";
import { startSystemPanels, stopSystemPanels } from "./system-panels/index.js";
import { showPanel } from "./system-panels/panel-window.js";
import { startMcpHttpServer } from "./services/mcp-http-server.js";
import { mcpProjectIdForProfile } from "./services/mcp-port.js";
import { drainAgendaStore } from "./services/agenda-store.js";
import { drainProductivityWrites } from "./handlers/productivity.js";
import { drainMailOutbox, heldMailCount } from "./handlers/mail.js";
import { MailNotSentError } from "./services/mail-outbox.js";
import { createSaveQuitGuard } from "./services/quit-guard.js";
import { drainPendingWrites } from "./services/pending-writes.js";
import { drainSettingsStores } from "./services/settings-store.js";
import { clearAttachmentPicks } from "./services/ai/attachments.js";
import { clearReminderIdentities } from "./services/apple-reminders.js";
import { drainNativeThemeWrites, loadNativeTheme } from "./platform/native-theme.js";
import { registerUpdateHandlers } from "./handlers/updates.js";
import { registerUsageCheckIn } from "./handlers/usage.js";
import { pauseAndDrainAppOperations, resumeAppOperations } from "./services/runtime-activity.js";

let updates: ReturnType<typeof registerUpdateHandlers> | undefined;
async function drainAppWrites(): Promise<void> {
  // Held emails go out now (their sends are pending writes the next step waits for). One that
  // fails is reported after the other saves finish, so quitting anyway still loses nothing else.
  let mailError: unknown;
  await drainMailOutbox().catch((error: unknown) => {
    mailError = error;
  });
  await drainProductivityWrites();
  await drainPendingWrites();
  await drainSettingsStores();
  await drainAgendaStore();
  await drainNativeThemeWrites();
  if (mailError) throw mailError;
}

// macOS is shutting down, restarting or logging out. A question here would hold that up, so
// held emails are sent without asking, as they were before the confirmation existed.
let systemShuttingDown = false;

const saveBeforeQuit = createSaveQuitGuard({
  confirmBeforeDrain: async () => {
    if (systemShuttingDown || !heldMailCount()) return true;
    const result = await dialog.showMessageBox({
      type: "warning",
      title: "Emails are waiting to send",
      message: "Send pending emails now and quit?",
      detail: "Keeping DayBoard open preserves the remaining Undo send time.",
      buttons: ["Keep Open", "Send and Quit"],
      defaultId: 0,
      cancelId: 0,
    });
    return result.response === 1;
  },
  drain: async () => {
    await pauseAndDrainAppOperations();
    await drainAppWrites();
  },
  onCancelled: resumeAppOperations,
  isUpdateInstallReady: () => updates?.status().phase === "installing",
  confirmUnfinished: async (error) => {
    if (error instanceof MailNotSentError) {
      const result = await dialog.showMessageBox({
        type: "warning",
        title: "An email wasn't sent",
        message: error.message,
        detail:
          "Keep DayBoard open to edit it and send it again. Quitting now discards what you wrote.",
        buttons: ["Keep Open", "Quit and Discard"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response === 1) return true;
      // The draft reopened in the main window, which may be closed.
      void focusMainWindow().catch(() => undefined);
      return false;
    }
    const result = await dialog.showMessageBox({
      type: "warning",
      title: "Changes are still saving",
      message: "Some changes have not finished saving.",
      detail:
        "Keep DayBoard open to let them finish. Quitting now may leave those changes unfinished.",
      buttons: ["Keep Open", "Quit Without Waiting"],
      defaultId: 0,
      cancelId: 0,
    });
    return result.response === 1;
  },
  resumeQuit: () => {
    clearAttachmentPicks();
    clearReminderIdentities();
    app.quit();
  },
});

if (acquireSingleInstanceLock()) {
  let quitting = false;
  app.on("before-quit", (event) => {
    void saveBeforeQuit(event).catch((error) => {
      logger.warn("main", "Quit cancelled because pending changes could not be checked", error);
    });
    // The guard cancels synchronously while saves drain; only a quit that goes ahead closes windows.
    quitting = !event.defaultPrevented;
  });
  // Squirrel closes every window before it quits, so an installing update must not be held open.
  keepMainWindowLoadedWhile(() => !quitting && updates?.status().phase !== "installing");

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", stopSystemPanels);

  app.on("activate", () => {
    // Only the dashboard counts: a Dock click while Settings, the update window or a panel is
    // open still brings the dashboard back.
    const window = getMainWindow();
    if (window && !window.isDestroyed()) {
      if (window.isVisible() && !window.isMinimized()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    } else {
      void createMainWindow().catch((error) =>
        logger.error("main", "Failed to reopen main window", error),
      );
    }
  });

  void app
    .whenReady()
    .then(async () => {
      powerMonitor.on("shutdown", () => {
        systemShuttingDown = true;
      });
      await loadNativeTheme();
      registerHandlers();
      updates = registerUpdateHandlers({
        prepareForInstall: async () => {
          await pauseAndDrainAppOperations();
          try {
            await drainAppWrites();
          } catch (error) {
            resumeAppOperations();
            throw error;
          }
        },
        resumeAfterInstallFailure: resumeAppOperations,
      });
      const usageCheckIn = registerUsageCheckIn();
      setupApplicationMenu({
        checkForUpdates: () => updates!.checkNow(),
        openQuickCapture: () => void showPanel("capture"),
        openMenuBarAgenda: () => void showPanel("menubar"),
      });
      startMcpHttpServer(
        mcpProjectIdForProfile(
          process.env.DAYBOARD_USER_DATA === undefined ? undefined : app.getPath("userData"),
        ),
      );
      startSystemPanels();
      await createMainWindow();
      updates.startAutomatic();
      usageCheckIn.start();
    })
    .catch((error) => {
      logger.error("main", "Failed to start DayBoard", error);
      app.quit();
    });
}
