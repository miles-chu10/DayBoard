/**
 * The anonymous daily check-in, shared by the desktop app and the license service. It carries a
 * random install ID the app made for this purpose (not the license installation ID and not derived
 * from hardware), the app version and the license state. Nothing else.
 */

export const USAGE_CHECKIN_PATH = "/v1/usage/checkin";

/** License states a configured release build can report. */
export const USAGE_LICENSE_STATES = [
  "trial",
  "expired",
  "licensed",
  "invalid",
  "network-error",
  "unreadable",
] as const;
export type UsageLicenseState = (typeof USAGE_LICENSE_STATES)[number];

/** crypto.randomUUID() output: a lowercase version 4 UUID. */
export const USAGE_INSTALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const USAGE_APP_VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,20})?$/;

export interface UsageCheckIn {
  installId: string;
  appVersion: string;
  licenseState: UsageLicenseState;
}

/** What Settings shows: whether this build sends check-ins, and the last day one was accepted. */
export interface UsageCheckInStatus {
  available: boolean;
  lastSentDay: string | null;
}

export function isUsageLicenseState(value: unknown): value is UsageLicenseState {
  return (USAGE_LICENSE_STATES as readonly unknown[]).includes(value);
}

/** Exactly the three fields, each valid. Anything extra is refused, so nothing else gets stored. */
export function isUsageCheckIn(value: unknown): value is UsageCheckIn {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    Object.keys(entry).length === 3 &&
    typeof entry.installId === "string" &&
    USAGE_INSTALL_ID_PATTERN.test(entry.installId) &&
    typeof entry.appVersion === "string" &&
    USAGE_APP_VERSION_PATTERN.test(entry.appVersion) &&
    isUsageLicenseState(entry.licenseState)
  );
}

/** The UTC calendar day, YYYY-MM-DD. Both sides count days in UTC. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
