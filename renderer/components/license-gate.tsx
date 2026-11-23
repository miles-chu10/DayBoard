import { useState, type ReactNode } from "react";
import { ChevronRight, Sparkles } from "lucide-react";

import { Badge, Button, EmptyState, Popover, PopoverContent, PopoverTrigger } from "../ui";
import {
  isLicenseBlocking,
  proBuyUrl,
  proPrice,
  useLicenseStatus,
  type LicenseStatus,
  type ProBuySource,
} from "../lib/license";
import { LICENSE_ACTIVATION_LIMIT } from "../../shared/license";
import { openExternal, openSettings } from "../lib/ipc";
import { AppMark } from "./app-mark";
import { ProOffer } from "./pro-offer";

/** True once license data has loaded and the current state blocks AI actions. */
export function useLicenseGate(): {
  blocked: boolean;
  status: LicenseStatus | undefined;
  checkoutUrl: string;
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  const { data, isPending, isError, refetch } = useLicenseStatus();
  return {
    blocked: !data || isError || isLicenseBlocking(data.status),
    status: data?.status,
    checkoutUrl: data?.checkoutUrl ?? "",
    loading: isPending,
    error: isError,
    retry: () => {
      void refetch();
    },
  };
}

function upsellCopy(status: LicenseStatus): {
  title: string;
  description: string;
} {
  switch (status.state) {
    case "expired": {
      const { price, note } = proPrice();
      return {
        title: "AI trial ended",
        description: `Your agenda, tasks, mail and notes keep working for free. DayBoard Pro brings back the Assistant, Quick Capture AI and dictation for ${price} once, on up to ${LICENSE_ACTIVATION_LIMIT} Macs.${note ? ` ${note}` : ""} 14-day refunds.`,
      };
    }
    case "invalid":
      // The reason varies (revoked, released by another account on this Mac, not verified yet).
      return {
        title: "License key needs attention",
        description: `${status.message} Open Settings → License to enter your key again or get DayBoard Pro.`,
      };
    case "network-error":
      return {
        title: "Can't verify your license",
        description:
          "The DayBoard license service hasn't been reachable for a while. Check your connection, then open Settings → License.",
      };
    case "unreadable":
      return {
        title: "Can't read license data",
        description:
          "DayBoard can't read the license data saved on this Mac. Open Settings → License to retry, enter your license key again, or reset license data on this Mac.",
      };
    default:
      return {
        title: "License required",
        description: "Open Settings → License to continue.",
      };
  }
}

/**
 * Wraps an AI surface: renders `children` when the license allows it, otherwise a "get Pro or
 * enter a key" prompt. Only AI is paid; every other view and action stays outside this gate.
 */
export function LicenseGate({
  children,
  placement = "inline",
}: {
  children: ReactNode;
  placement?: "inline" | "center" | "viewport";
}) {
  const { blocked, status, checkoutUrl, loading, error, retry } = useLicenseGate();
  if (!blocked) return <>{children}</>;
  if (loading || error || !status)
    return (
      <EmptyState
        placement={placement}
        title={error ? "License status unavailable" : "Checking license…"}
        description={
          error
            ? "DayBoard could not read your license status. Your saved data remains available."
            : undefined
        }
        actions={error ? <Button onClick={retry}>Retry</Button> : undefined}
      />
    );

  const copy = upsellCopy(status);
  return (
    <EmptyState
      placement={placement}
      media={<AppMark className="size-12" />}
      title={copy.title}
      description={copy.description}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <LicenseUpsellActions checkoutUrl={checkoutUrl} status={status} from="app-ai-locked" />
        </div>
      }
    />
  );
}

/**
 * The buy and License buttons of every AI upsell. Once the trial has ended the buy button names
 * the price, and the second button speaks to people who already bought a key.
 */
export function LicenseUpsellActions({
  checkoutUrl,
  status,
  from,
  size,
}: {
  checkoutUrl: string;
  status: LicenseStatus;
  from: ProBuySource;
  size?: "small";
}) {
  const buyUrl = proBuyUrl(checkoutUrl, from);
  const ended = status.state === "expired";
  return (
    <>
      {buyUrl ? (
        <Button variant="accent" size={size} onClick={() => void openExternal(buyUrl)}>
          {ended ? `Get DayBoard Pro — ${proPrice().price}` : "Get DayBoard Pro"}
        </Button>
      ) : null}
      <Button size={size} onClick={() => void openSettings("license")}>
        {ended ? "I have a license key" : "Open License Settings"}
      </Button>
    </>
  );
}

/** For call sites that want to keep their own layout and just disable a control instead of swapping it out. */
export function useLicenseGateAction(action: () => void): {
  run: () => void;
  blocked: boolean;
  disabledReason: string | undefined;
} {
  const { blocked, status } = useLicenseGate();
  return {
    run: () => {
      if (blocked) {
        void openSettings("license");
        return;
      }
      action();
    },
    blocked,
    disabledReason: blocked && status ? upsellCopy(status).description : undefined,
  };
}

export function LicenseStatusControl() {
  const { data, isError } = useLicenseStatus();
  if (
    !isError &&
    (!data ||
      data.status.state === "demo" ||
      data.status.state === "licensed" ||
      data.status.state === "disabled")
  )
    return null;
  const label = isError
    ? "License unavailable"
    : data?.status.state === "trial"
      ? `${data.status.daysLeft} day${data.status.daysLeft === 1 ? "" : "s"} left in your AI trial`
      : data?.status.state === "unconfigured"
        ? "Preview build"
        : data?.status.state === "unreadable"
          ? "License data needs attention"
          : "Unlock AI · DayBoard Pro";
  // During the trial and once it ends, the counter opens what Pro costs and adds, one click from
  // checkout; key entry stays in Settings. Other states need Settings itself.
  const offer =
    !isError &&
    (data?.status.state === "trial" || data?.status.state === "expired") &&
    proBuyUrl(data.checkoutUrl, "app-sidebar") !== "";
  if (offer && data) return <SidebarProCard label={label} checkoutUrl={data.checkoutUrl} />;
  return (
    <Button
      size="small"
      variant="transparent"
      className={SIDEBAR_CONTROL_CLASS}
      onClick={() => void openSettings("license")}
    >
      <SidebarControlLabel>{label}</SidebarControlLabel>
    </Button>
  );
}

const SIDEBAR_CONTROL_CLASS = "w-full justify-start gap-2 rounded-lg text-secondary";

/** The sidebar counter's contents: a Pro glyph, what the license needs, and a way in. */
function SidebarControlLabel({ children }: { children: string }) {
  return (
    <>
      <Sparkles className="text-accent" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      <ChevronRight className="text-tertiary" aria-hidden />
    </>
  );
}

/** A small "Pro" mark beside the account name once this Mac has a working license. */
export function ProBadge() {
  const { data, isError } = useLicenseStatus();
  if (isError || data?.status.state !== "licensed") return null;
  return (
    <Badge color="blue" className="h-4 px-1.5 text-mini" title="DayBoard Pro is active on this Mac">
      Pro
    </Badge>
  );
}

function SidebarProCard({ label, checkoutUrl }: { label: string; checkoutUrl: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="small" variant="transparent" className={SIDEBAR_CONTROL_CLASS}>
          <SidebarControlLabel>{label}</SidebarControlLabel>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[22rem] p-4">
        <ProOffer
          checkoutUrl={checkoutUrl}
          from="app-sidebar"
          secondary={
            <Button
              onClick={() => {
                setOpen(false);
                void openSettings("license");
              }}
            >
              Enter key
            </Button>
          }
        />
      </PopoverContent>
    </Popover>
  );
}
