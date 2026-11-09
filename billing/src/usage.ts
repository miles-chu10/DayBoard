import type { Env } from "./config.ts";
import { error, limit, readJson, securityHeaders } from "./http.ts";
import { isUsageCheckIn, utcDay } from "../../shared/usage-checkin.ts";

/** About 13 months, so a month can be compared with the same month a year earlier. */
export const USAGE_RETENTION_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Records an install's anonymous check-in for today (UTC). The day comes from the server's clock,
 * never the request. A second check-in the same day only updates that day's version and state.
 */
export async function usageCheckIn(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return error(405, "method_not_allowed");
  if (!(await limit(request, env, "usage:checkin", 20))) return error(429, "rate_limited");
  let input: unknown;
  try {
    input = await readJson(request, 512);
  } catch {
    return error(400, "invalid_body");
  }
  if (!isUsageCheckIn(input)) return error(400, "invalid_checkin");
  const now = Date.now();
  const day = utcDay(new Date(now));
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO usage_checkins (install_id,day,first_day,app_version,license_state)
      VALUES (?,?,COALESCE((SELECT MIN(first_day) FROM usage_checkins WHERE install_id=?),?),?,?)
      ON CONFLICT(install_id,day) DO UPDATE SET
        app_version=excluded.app_version, license_state=excluded.license_state`,
    ).bind(input.installId, day, input.installId, day, input.appVersion, input.licenseState),
    env.DB.prepare("DELETE FROM usage_checkins WHERE day < ?").bind(
      utcDay(new Date(now - USAGE_RETENTION_DAYS * DAY_MS)),
    ),
  ]);
  return new Response(null, { status: 204, headers: securityHeaders });
}
