import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { toast } from "../ui";
import { errorMessage } from "./ipc";
import {
  LICENSE_ACTIVATION_LIMIT,
  LICENSE_FORGET_CONFIRMATION,
  LICENSE_RESET_CONFIRMATION,
  LICENSE_SUPPORT_EMAIL,
  type LicenseDeactivationPayload,
  type LicenseStatus,
  type LicenseStatusPayload,
} from "../../shared/license";
export type {
  LicenseDeactivationPayload,
  LicenseStatus,
  LicenseStatusPayload,
} from "../../shared/license";

export { isLicenseBlocking } from "../../shared/license";

export const LICENSE_STATUS_COPY: Record<
  LicenseStatus["state"],
  { label: string; description: string }
> = {
  demo: {
    label: "Demo",
    description: "This preview uses fictional data. Purchases are unavailable in demo mode.",
  },
  unconfigured: {
    label: "Preview build",
    description:
      "Purchases are not available in this build yet. You can continue using the preview.",
  },
  disabled: {
    label: "Community build",
    description: "This build does not require a purchase.",
  },
  trial: {
    label: "AI trial",
    description:
      "Everything in DayBoard is free except AI. Your AI trial starts the first time you use AI; DayBoard Pro then unlocks it with a one-time purchase that includes future updates.",
  },
  expired: {
    label: "AI trial ended",
    description:
      "Everything else in DayBoard stays free. Get DayBoard Pro, a one-time purchase, to keep using AI.",
  },
  invalid: {
    label: "Key needs attention",
    description:
      "DayBoard Pro isn't unlocked on this Mac right now; the reason is below. Enter your key again or get DayBoard Pro.",
  },
  licensed: {
    label: "DayBoard Pro",
    description: "Thanks for supporting DayBoard.",
  },
  "network-error": {
    label: "Can't verify",
    description: "DayBoard couldn't reach its license service. Check your connection.",
  },
  unreadable: {
    label: "Can't read license data",
    description:
      "DayBoard can't read the license data saved on this Mac, so AI is paused. Everything else keeps working. If macOS asked for Keychain access, allow it and choose Retry. Otherwise, enter your license key to activate again, or reset license data on this Mac.",
  },
};

// The launch price ends December 31, 2026 at 11:59 PM PST, as the website and checkout page say.
const LAUNCH_PRICE_ENDS = Date.UTC(2027, 0, 1, 7, 59);
const DAY_MS = 86_400_000;

/** DayBoard Pro's price as the app states it, and how long the launch price lasts. */
export function proPrice(now = Date.now()): { price: string; note: string } {
  const daysLeft = Math.ceil((LAUNCH_PRICE_ENDS - now) / DAY_MS);
  if (daysLeft <= 0) return { price: "$9", note: "" };
  return {
    price: "$5",
    note:
      daysLeft === 1
        ? "Last day at the $5 launch price, then $9."
        : daysLeft <= 60
          ? `Launch price for ${daysLeft} more days, then $9.`
          : "Launch price until December 31, then $9.",
  };
}

/** What Pro adds, in the website's words. */
export const PRO_BENEFITS = [
  "The Assistant, on the Claude or ChatGPT plan you already have",
  "AI in Quick Capture, dictation and the daily briefing",
  `Up to ${LICENSE_ACTIVATION_LIMIT} Macs, with future updates included`,
] as const;

/**
 * Where in the app a "Get DayBoard Pro" button sits. Checkout keeps it with the sale
 * (`/buy?from=`), so sales can be counted per button; it names a place, never the person.
 */
export type ProBuySource =
  | "app-trial-reminder"
  | "app-sidebar"
  | "app-settings"
  | "app-ai-locked"
  | "app-quick-capture";

export function proBuyUrl(checkoutUrl: string, from: ProBuySource): string {
  if (!checkoutUrl.trim()) return "";
  try {
    const url = new URL(checkoutUrl);
    url.searchParams.set("from", from);
    return url.href;
  } catch {
    return "";
  }
}

/**
 * Home's trial-ending reminder shows once at 3 days left and once on the last day. Returns which
 * of the two is due, or null while the trial has more days left or for any other state.
 */
export type TrialReminderStage = "3-days" | "last-day";
export function trialReminderStage(status: LicenseStatus | undefined): TrialReminderStage | null {
  if (status?.state !== "trial") return null;
  if (status.daysLeft <= 1) return "last-day";
  return status.daysLeft <= 3 ? "3-days" : null;
}

export const LICENSE_RESET_COPY = {
  action: "Reset license data on this Mac",
  title: "Reset license data on this Mac?",
  description:
    "DayBoard keeps the unreadable license file as a backup in its data folder and starts fresh. Your tasks, mail, calendar and settings aren't affected. If you bought DayBoard Pro, enter your license key again afterward.",
  confirm: "Reset",
};

/** Shown while the license service hasn't confirmed that a removed key's slot is free. */
export const LICENSE_RELEASE_PENDING_COPY = {
  toast:
    "DayBoard stopped using the license on this Mac, but couldn't confirm its activation slot is free.",
  callout: `DayBoard couldn't confirm with the license service that this Mac's slot is free, so it may still count toward the key's ${LICENSE_ACTIVATION_LIMIT}-Mac limit. DayBoard keeps the key encrypted on this Mac only until the license service confirms the slot is free. It tries again automatically whenever it's open and online, or choose Try again now. If another Mac still can't activate the key, email ${LICENSE_SUPPORT_EMAIL}.`,
  retry: "Try again",
};

/** "Forget without releasing": deletes the kept key and gives up on freeing its slot. */
export const LICENSE_FORGET_COPY = {
  action: "Forget without releasing",
  title: "Delete the key without freeing its slot?",
  description: `DayBoard deletes the license key it kept on this Mac and stops trying to free its activation slot. The slot may stay in use, counting toward the key's ${LICENSE_ACTIVATION_LIMIT}-Mac limit, until you email ${LICENSE_SUPPORT_EMAIL} to free it.`,
  confirm: "Delete key",
  toast: `Deleted the license key from this Mac. Its activation slot may still be in use; email ${LICENSE_SUPPORT_EMAIL} to free it.`,
};

/** Confirmation before "Deactivate this device" removes a working key from this Mac. */
export const LICENSE_DEACTIVATE_COPY = {
  title: "Deactivate DayBoard Pro on this Mac?",
  description:
    "DayBoard removes your license key from this Mac and frees its activation slot for another Mac. AI stops working here once any remaining trial time runs out. Everything else keeps working. To use DayBoard Pro on this Mac again, you'll need to enter your license key, so make sure you have it saved first.",
  confirm: "Deactivate",
};

/** Toasts after "Deactivate this device" or "Remove saved key", by release outcome. */
export const LICENSE_REMOVED_COPY = {
  released: "Removed the license from this Mac. Its activation slot is free.",
  none: "Removed the license key from this Mac.",
};

function license<T = LicenseStatusPayload>(channel: string, ...args: unknown[]): Promise<T> {
  return window.dayboard.ipc.invoke<T>(channel, ...args);
}

export const licenseQueryKey = ["license"] as const;

export function useLicenseStatus() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: licenseQueryKey,
    // `license:refresh` respects the daily revalidation cap internally, so calling it on every
    // mount (once per app launch, in practice) is how the license silently stays revalidated.
    queryFn: () => license("license:refresh"),
    staleTime: 5 * 60_000,
  });

  useEffect(
    () =>
      window.dayboard.ipc.onNotification("license:changed", (params) => {
        queryClient.setQueryData(licenseQueryKey, params as LicenseStatusPayload);
      }),
    [queryClient],
  );

  return query;
}

const licenseSnapshotKey = ["license", "stored"] as const;

/**
 * The stored license status, for the floating panels: `license:status` never revalidates or starts
 * the trial, and panels may not call `license:refresh`. A trial can end without a `license:changed`
 * broadcast, so refetch it whenever the panel is shown.
 */
export function useLicenseSnapshot() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: licenseSnapshotKey,
    queryFn: () => license("license:status"),
  });

  useEffect(
    () =>
      window.dayboard.ipc.onNotification("license:changed", (params) => {
        queryClient.setQueryData(licenseSnapshotKey, params as LicenseStatusPayload);
      }),
    [queryClient],
  );

  return query;
}

export function useActivateLicense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (licenseKey: string) => license("license:activate", licenseKey),
    onSuccess: (payload) => queryClient.setQueryData(licenseQueryKey, payload),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeactivateLicense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => license<LicenseDeactivationPayload>("license:deactivate"),
    onSuccess: ({ status, checkoutUrl, releasePending, release }) => {
      queryClient.setQueryData(licenseQueryKey, { status, checkoutUrl, releasePending });
      if (release === "pending") toast.warning(LICENSE_RELEASE_PENDING_COPY.toast);
      else toast.success(LICENSE_REMOVED_COPY[release]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useForgetPendingRelease() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => license("license:forget-release", LICENSE_FORGET_CONFIRMATION),
    onSuccess: (payload) => {
      queryClient.setQueryData(licenseQueryKey, payload);
      toast.success(LICENSE_FORGET_COPY.toast);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useResetLicenseData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => license("license:reset", LICENSE_RESET_CONFIRMATION),
    onSuccess: (payload) => {
      queryClient.setQueryData(licenseQueryKey, payload);
      toast.success("License data on this Mac was reset. The old file was kept as a backup.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
