import type { SourceResult } from "@main/shared-types";

export interface ConnectionStatus {
  label: string;
  /** Google's line in the profile tooltip. */
  googleDetail: string;
  tone: "ok" | "attention" | "off";
}

/**
 * The sidebar footer's account line. A saved Google sign-in can stop working (an expired session,
 * or a permission left unticked on Google's screen); the account status still says connected then,
 * and only the Tasks and Calendar results show it.
 */
export function connectionStatus(input: {
  google?: { connected: boolean; email: string | null };
  /** Results of the Google sources that are turned on. */
  googleSources: (SourceResult<unknown> | undefined)[];
  /** False only when Apple Reminders is turned on and not allowed. */
  remindersOk: boolean;
}): ConnectionStatus {
  if (!input.google?.connected)
    return { label: "Google not connected", googleDetail: "Google: not connected", tone: "off" };
  const who = input.google.email ?? "connected";
  const states = input.googleSources.map((result) => result?.state);
  if (states.includes("not-connected"))
    return {
      label: "Google needs sign-in",
      googleDetail: `Google: ${who}, sign in again in Settings`,
      tone: "attention",
    };
  if (states.includes("not-granted"))
    return {
      label: "Google needs permission",
      googleDetail: `Google: ${who}, sign in again in Settings and allow access`,
      tone: "attention",
    };
  return {
    label: input.remindersOk ? "Connected" : "Connected · Reminders off",
    googleDetail: `Google: ${who}`,
    tone: "ok",
  };
}
