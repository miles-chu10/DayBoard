// The Software Update window: one small window that either offers a version with its release notes
// or shows check/download/install progress. Its renderer lives in renderer/update.

import { BrowserWindow } from "electron";

import type { UpdateWindowState } from "../shared/app-updates.js";
import { ipcMain, logger } from "./platform/index.js";
import { entryUrl, hardenWindow, secureWebPreferences } from "./window.js";

const SIZES = {
  prompt: { width: 620, height: 520 },
  progress: { width: 460, height: 172 },
} as const;

let window: BrowserWindow | null = null;

export function createUpdateWindowHost(options: { onClosed: () => void }) {
  return {
    isOpen: () => Boolean(window && !window.isDestroyed()),
    close: () => {
      if (window && !window.isDestroyed()) window.close();
    },
    show(state: UpdateWindowState) {
      const size = SIZES[state.mode];
      const title = state.mode === "prompt" ? "Software Update" : "Updating DayBoard";
      if (window && !window.isDestroyed()) {
        window.setTitle(title);
        window.setContentSize(size.width, size.height, true);
        ipcMain.broadcast("updates:windowChanged", state);
        window.show();
        window.focus();
        return;
      }
      const next = new BrowserWindow({
        ...size,
        useContentSize: true,
        title,
        show: false,
        center: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        webPreferences: secureWebPreferences(),
      });
      window = next;
      const url = entryUrl("update-window.html");
      hardenWindow(next, url);
      next.once("ready-to-show", () => {
        next.show();
        next.focus();
      });
      next.on("closed", () => {
        if (window === next) window = null;
        options.onClosed();
      });
      void next
        .loadURL(url)
        .catch((error) => logger.warn("updates", "Update window failed", error));
    },
  };
}
