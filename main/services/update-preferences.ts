import * as path from "node:path";

import { isReleaseVersion } from "../../shared/release-notes.js";
import type { UpdatePreferences } from "../../shared/app-updates.js";
import { app } from "../platform/index.js";
import { createJsonStore } from "./json-store.js";

export function parseUpdatePreferences(value: unknown): UpdatePreferences {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    automaticDownload: record.automaticDownload === true,
    skippedVersion: isReleaseVersion(record.skippedVersion) ? record.skippedVersion : null,
  };
}

export const updatePreferences = createJsonStore<UpdatePreferences>({
  path: () => path.join(app.getPath("userData"), "update-preferences.json"),
  parse: parseUpdatePreferences,
});
