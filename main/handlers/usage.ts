import * as path from "node:path";

import { app, ipcMain } from "../platform/index.js";
import { isAppStoreBuild } from "../../shared/app-store-build.js";
import type { UsageCheckInStatus } from "../../shared/usage-checkin.js";
import { isDemoMode } from "../services/demo-data.js";
import { configuredLicenseProduct, isLicenseGatingDisabled } from "../services/license/config.js";
import { getLicenseStatus } from "../services/license/index.js";
import { getSettings } from "../services/settings-store.js";
import { createUsageCheckIn } from "../services/usage-checkin.js";

/**
 * Only official releases that carry the license service check in. Previews, test, QA, demo and
 * App Store builds never do, so our own testing doesn't inflate the counts.
 */
export function registerUsageCheckIn(): { start: () => () => void } {
  const product = configuredLicenseProduct();
  const checkIn =
    !isAppStoreBuild &&
    process.env.DAYBOARD_RELEASE === "1" &&
    !isLicenseGatingDisabled() &&
    product
      ? createUsageCheckIn({
          apiUrl: product.apiUrl,
          appVersion: app.getVersion(),
          statePath: path.join(app.getPath("userData"), "usage-checkin.json"),
          isEnabled: async () => !isDemoMode() && (await getSettings()).privacy.usageCheckIn,
          licenseState: async () => (await getLicenseStatus()).status.state,
        })
      : null;

  ipcMain.handle("usage:checkInStatus", async (): Promise<UsageCheckInStatus> => ({
    available: checkIn !== null && !isDemoMode(),
    lastSentDay: checkIn ? await checkIn.lastSentDay() : null,
  }));
  return { start: () => checkIn?.start() ?? (() => undefined) };
}
