// Anonymous daily check-in. At most once per UTC day, a release build tells the license service
// that this install is in use: a random install ID made here (not the license installation ID and
// not derived from hardware), the app version and the license state. Nothing from the calendar,
// tasks, reminders, mail, AI, Google account or license key is sent. Settings > Updates turns it
// off. A failed check-in is retried on the next hourly look, without telling the user.

import { randomUUID } from "node:crypto";

import {
  USAGE_CHECKIN_PATH,
  USAGE_INSTALL_ID_PATTERN,
  isUsageLicenseState,
  utcDay,
  type UsageCheckIn,
} from "../../shared/usage-checkin.js";
import { readFileIfExists, writeFileAtomic } from "./file-store.js";

const TIMEOUT_MS = 10_000;
const FIRST_DELAY_MS = 30_000;
const INTERVAL_MS = 60 * 60_000;

interface CheckInRecord {
  installId: string;
  /** UTC day of the last check-in the service accepted. */
  lastDay: string | null;
}

export type CheckInResult = "sent" | "off" | "already-sent" | "failed";

export interface UsageCheckInOptions {
  /** The license service origin, e.g. https://api.getdayboard.com. */
  apiUrl: string;
  appVersion: string;
  /** JSON file under userData holding the install ID and the last day sent. */
  statePath: string;
  isEnabled: () => Promise<boolean>;
  /** The cached license state; must not contact the license service or start the trial. */
  licenseState: () => Promise<string>;
  fetch?: typeof fetch;
  now?: () => Date;
  firstDelayMs?: number;
  intervalMs?: number;
}

export function createUsageCheckIn(options: UsageCheckInOptions) {
  const send = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  let running: Promise<CheckInResult> | null = null;

  async function read(): Promise<CheckInRecord | null> {
    const raw = await readFileIfExists(options.statePath);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw.toString("utf8")) as Partial<CheckInRecord> | null;
      if (typeof value?.installId === "string" && USAGE_INSTALL_ID_PATTERN.test(value.installId))
        return {
          installId: value.installId,
          lastDay: typeof value.lastDay === "string" ? value.lastDay : null,
        };
    } catch {
      // A damaged file gets a fresh install ID below.
    }
    return null;
  }

  async function write(record: CheckInRecord): Promise<void> {
    await writeFileAtomic(options.statePath, `${JSON.stringify(record)}\n`);
  }

  async function attempt(): Promise<CheckInResult> {
    if (!(await options.isEnabled())) return "off";
    const day = utcDay(now());
    let record = await read();
    if (record?.lastDay === day) return "already-sent";
    const licenseState = await options.licenseState();
    if (!isUsageLicenseState(licenseState)) return "failed";
    if (!record) {
      // Saved before sending, so a failed first try keeps the same ID for the retry.
      record = { installId: randomUUID(), lastDay: null };
      await write(record);
    }
    const body: UsageCheckIn = {
      installId: record.installId,
      appVersion: options.appVersion,
      licenseState,
    };
    const response = await send(`${options.apiUrl}${USAGE_CHECKIN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    void response.body?.cancel().catch(() => undefined);
    if (!response.ok) return "failed";
    await write({ ...record, lastDay: day });
    return "sent";
  }

  /** One check-in attempt; concurrent calls share it. Never rejects. */
  function runOnce(): Promise<CheckInResult> {
    running ??= attempt()
      .catch((): CheckInResult => "failed")
      .finally(() => {
        running = null;
      });
    return running;
  }

  /** Tries shortly after launch, then looks once an hour. Returns a stop function. */
  function start(): () => void {
    const first = setTimeout(() => void runOnce(), options.firstDelayMs ?? FIRST_DELAY_MS);
    const repeat = setInterval(() => void runOnce(), options.intervalMs ?? INTERVAL_MS);
    first.unref?.();
    repeat.unref?.();
    return () => {
      clearTimeout(first);
      clearInterval(repeat);
    };
  }

  /** The UTC day of the last accepted check-in, or null. */
  async function lastSentDay(): Promise<string | null> {
    return (await read().catch(() => null))?.lastDay ?? null;
  }

  return { runOnce, start, lastSentDay };
}
