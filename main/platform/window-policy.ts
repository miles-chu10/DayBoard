import * as path from "node:path";
import { pathToFileURL } from "node:url";

const ENTRIES = new Set([
  "main-window.html",
  "settings-window.html",
  "panel-window.html",
  "update-window.html",
]);

export function windowEntryUrl(
  htmlFileName: string,
  rendererRoot: string,
  devServer?: string,
): string {
  if (!ENTRIES.has(htmlFileName)) throw new Error("Unknown DayBoard window entry");
  if (!devServer) return pathToFileURL(path.join(rendererRoot, htmlFileName)).href;

  const base = new URL(devServer);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error("Invalid local Electron renderer URL");
  }
  return new URL(htmlFileName, base).href;
}

/** Only the exact document entry may host a privileged preload. Hash routes stay in that entry. */
export function isAllowedWindowNavigation(actual: string, expected: string): boolean {
  try {
    const target = new URL(actual);
    const entry = new URL(expected);
    target.hash = "";
    return target.href === entry.href;
  } catch {
    return false;
  }
}

export function isExternalWebUrl(url: string): boolean {
  try {
    const target = new URL(url);
    return (
      (target.protocol === "http:" || target.protocol === "https:") &&
      !target.username &&
      !target.password
    );
  } catch {
    return false;
  }
}

/**
 * What closing the dashboard does. macOS keeps it loaded and hides it, so a Dock click shows it as
 * it was instead of starting the renderer and every query again. Quitting and installing an update
 * close every window first, so then it must really close.
 */
export function mainWindowCloseAction(state: {
  platform: NodeJS.Platform;
  keepLoaded: boolean;
  fullScreen: boolean;
}): "close" | "hide" | "leave-full-screen" {
  if (state.platform !== "darwin" || !state.keepLoaded) return "close";
  return state.fullScreen ? "leave-full-screen" : "hide";
}
