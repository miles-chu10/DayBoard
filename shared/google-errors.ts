/** Leads every error for a Google quota or rate limit, in main-process errors and in the UI. */
export const GOOGLE_BUSY_MESSAGE = "Google is busy right now. Try again in a minute.";

/** True for an error, from either side of IPC, that came from a Google quota or rate limit. */
export function isGoogleBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes(GOOGLE_BUSY_MESSAGE);
}
