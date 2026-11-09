import type { ProviderStatus } from "../../main/shared-types";
import type { LicenseStatus } from "../../shared/license";

/** The first-run welcome's steps, in order. */
export const ONBOARDING_STEPS = ["welcome", "connect", "ai", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * What the AI step says about the trial and DayBoard Pro. Null where this build sells nothing
 * (community and preview builds) or while the status loads. No price: it changes over time.
 */
export function aiPlanCopy(status: LicenseStatus | undefined): string | null {
  switch (status?.state) {
    case "trial":
      return `Your AI trial has ${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} left, counted from the first time DayBoard uses AI for you, such as sorting new mail. After that, DayBoard Pro unlocks AI with a one-time purchase. Everything else in DayBoard stays free.`;
    case "expired":
      return "Your AI trial has ended. DayBoard Pro unlocks AI with a one-time purchase. Everything else in DayBoard stays free.";
    case "licensed":
      return "DayBoard Pro is unlocked on this Mac.";
    case "invalid":
    case "network-error":
    case "unreadable":
      return "Your DayBoard Pro license needs attention. Open Settings → License to fix it. Everything else keeps working.";
    case "demo":
      return "Demo mode uses sample AI responses.";
    default:
      return null;
  }
}

export interface ProviderIndicator {
  variant: "loading" | "success" | "warning" | "error";
  text: string;
}

/** A subscription provider's command-line tool, as a short status beside its name. */
export function providerIndicator(status: ProviderStatus | undefined): ProviderIndicator {
  if (!status) return { variant: "loading", text: "Checking…" };
  if (status.ok) return { variant: "success", text: "Installed" };
  if (status.reason === "not-logged-in") return { variant: "warning", text: "Not signed in" };
  if (status.reason === "missing") return { variant: "error", text: "Not installed" };
  return { variant: "error", text: "Unavailable" };
}
