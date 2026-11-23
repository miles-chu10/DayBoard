import { useState, type ReactNode } from "react";

import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Field,
  FieldGroup,
  FieldSet,
  Input,
  Status,
  Text,
  type BadgeProps,
} from "../ui";
import { AppMark } from "../components/app-mark";
import { ProBenefits, ProOffer } from "../components/pro-offer";
import {
  LICENSE_DEACTIVATE_COPY,
  LICENSE_FORGET_COPY,
  LICENSE_RELEASE_PENDING_COPY,
  LICENSE_RESET_COPY,
  LICENSE_STATUS_COPY,
  proBuyUrl,
  proPrice,
  useActivateLicense,
  useDeactivateLicense,
  useForgetPendingRelease,
  useLicenseStatus,
  useResetLicenseData,
  type LicenseStatus,
} from "../lib/license";
import { copyFeedbackAddress, sendFeedback } from "../lib/feedback";
import { openExternal } from "../lib/ipc";
import {
  LICENSE_ACTIVATION_LIMIT,
  LICENSE_SUPPORT_EMAIL,
  LICENSE_TRIAL_DAYS,
} from "../../shared/license";

const days = (count: number) => `${count} day${count === 1 ? "" : "s"}`;

/** The plan card's badge: the one word (or count) that says where this Mac stands. */
function planBadge(status: LicenseStatus): { label: string; color: BadgeProps["color"] } | null {
  switch (status.state) {
    case "licensed":
      return { label: "Active", color: "green" };
    case "trial":
      return { label: `${days(status.daysLeft)} left`, color: "blue" };
    case "expired":
      return { label: "Ended", color: "orange" };
    case "network-error":
      return { label: "Not verified", color: "orange" };
    case "invalid":
    case "unreadable":
      return { label: "Needs attention", color: "orange" };
    default:
      return null;
  }
}

/** Which plan this Mac is on and where it stands, at the top of the tab. */
function PlanCard({ status }: { status: LicenseStatus }) {
  const copy = LICENSE_STATUS_COPY[status.state];
  const badge = planBadge(status);
  const trialLeft =
    status.state === "trial" ? Math.min(1, Math.max(0, status.daysLeft / LICENSE_TRIAL_DAYS)) : 0;
  return (
    <section aria-label="Plan" className="flex flex-col gap-3 rounded-xl bg-well p-4">
      <div className="flex items-start gap-3">
        <AppMark className="size-12" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Text as="h2" variant="extra-large-strong">
              {copy.label}
            </Text>
            {badge ? <Badge color={badge.color}>{badge.label}</Badge> : null}
          </div>
          <Text as="p" variant="small" color="secondary" className="max-w-[460px]">
            {copy.description}
          </Text>
        </div>
      </div>
      {status.state === "trial" ? (
        <div
          role="progressbar"
          aria-label="AI trial days left"
          aria-valuemin={0}
          aria-valuemax={LICENSE_TRIAL_DAYS}
          aria-valuenow={status.daysLeft}
          className="h-1.5 overflow-hidden rounded-full bg-control"
        >
          <div
            className="h-full rounded-full bg-support-blue"
            style={{ width: `${trialLeft * 100}%` }}
          />
        </div>
      ) : null}
    </section>
  );
}

/** A settings row: what it is on the left, its value or action on the right. */
function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Field label={label} description={description} orientation="horizontal">
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </Field>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function KeyEntry({
  busy,
  onSubmit,
  description,
  secondary = false,
}: {
  busy: boolean;
  onSubmit: (key: string) => void;
  description?: string;
  /** Below the Pro offer, so its buy button stays the one accent button. */
  secondary?: boolean;
}) {
  const [key, setKey] = useState("");
  const commit = () => {
    const trimmed = key.trim();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    // The receipt page and license email say "Paste your key into License key".
    <Field label="License key" description={description}>
      <div className="flex gap-2">
        <Input
          aria-label="License key"
          placeholder="Paste your license key"
          value={key}
          disabled={busy}
          onChange={(event) => setKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) commit();
          }}
          className="flex-1"
        />
        <Button
          variant={secondary ? "filled" : "accent"}
          onClick={commit}
          disabled={busy || !key.trim()}
        >
          {busy ? "Activating…" : "Activate"}
        </Button>
      </div>
    </Field>
  );
}

export function LicenseTab() {
  const { data, isLoading, isError, refetch } = useLicenseStatus();
  const activate = useActivateLicense();
  const deactivate = useDeactivateLicense();
  const reset = useResetLicenseData();
  const forget = useForgetPendingRelease();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingForget, setConfirmingForget] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  if (isError)
    return (
      <FieldSet title="License">
        <Callout color="orange">
          DayBoard could not read your license status. Your saved data remains available.
        </Callout>
        <Button onClick={() => void refetch()}>Retry</Button>
      </FieldSet>
    );
  if (isLoading || !data) {
    return (
      <FieldSet title="License">
        <Field label="Status">
          <Status variant="loading">Checking…</Status>
        </Field>
      </FieldSet>
    );
  }

  const { status, checkoutUrl } = data;
  const buyUrl = proBuyUrl(checkoutUrl, "app-settings");
  // While trying AI or once the trial ends, lead with what Pro costs and adds; people who already
  // bought find key entry right below. Other states lead with fixing the saved key.
  const offerFirst = buyUrl !== "" && (status.state === "trial" || status.state === "expired");
  // From the saved record, so it survives reopening Settings and clears once a retry confirms.
  // Only while no key is saved, so "Try again" can never remove a newly entered key.
  const releasePending =
    data.releasePending === true && (status.state === "trial" || status.state === "expired");
  const releaseBusy = deactivate.isPending || forget.isPending;
  // Demo, preview and community builds have nothing to buy, enter or manage.
  const purchasable =
    status.state !== "demo" && status.state !== "unconfigured" && status.state !== "disabled";
  const licensed = status.state === "licensed";
  const savedKey =
    status.state === "licensed" || status.state === "invalid" || status.state === "network-error"
      ? status.keyHint
      : null;

  return (
    <div className="flex flex-col gap-6">
      <PlanCard status={status} />

      {status.state === "invalid" ? <Callout color="orange">{status.message}</Callout> : null}

      {releasePending ? (
        <Callout
          color="orange"
          actions={
            <>
              <Button size="small" onClick={() => deactivate.mutate()} disabled={releaseBusy}>
                {deactivate.isPending ? "Trying…" : LICENSE_RELEASE_PENDING_COPY.retry}
              </Button>
              <Button
                size="small"
                variant="transparent"
                onClick={() => setConfirmingForget(true)}
                disabled={releaseBusy}
              >
                {LICENSE_FORGET_COPY.action}
              </Button>
            </>
          }
        >
          {LICENSE_RELEASE_PENDING_COPY.callout}
        </Callout>
      ) : null}

      {offerFirst ? (
        <ProOffer
          checkoutUrl={checkoutUrl}
          from="app-settings"
          className="rounded-xl bg-well p-4"
        />
      ) : null}

      {purchasable && !licensed ? (
        <FieldGroup>
          {offerFirst ? (
            <KeyEntry
              busy={activate.isPending}
              onSubmit={(key) => activate.mutate(key)}
              description="Already bought Pro? Paste the key from your receipt page or email."
              secondary
            />
          ) : (
            <KeyEntry
              busy={activate.isPending}
              onSubmit={(key) => activate.mutate(key)}
              description="After checkout, copy your license key from the DayBoard receipt page and activate it here."
            />
          )}
          {status.state === "unreadable" ? (
            <Row
              label="Still can't read it?"
              description="Retry after allowing Keychain access, or start fresh. Your tasks, mail, calendar and settings aren't affected."
            >
              <Button size="small" onClick={() => void refetch()}>
                Retry
              </Button>
              <Button
                size="small"
                variant="destructive"
                onClick={() => setConfirmingReset(true)}
                disabled={reset.isPending}
              >
                {reset.isPending ? "Resetting…" : LICENSE_RESET_COPY.action}
              </Button>
            </Row>
          ) : null}
          {buyUrl && !offerFirst ? (
            <Row
              label="Need a key?"
              description={`DayBoard Pro is ${proPrice().price} once, with 14-day refunds.`}
            >
              <Button size="small" onClick={() => openExternal(buyUrl)}>
                Get DayBoard Pro
              </Button>
            </Row>
          ) : null}
        </FieldGroup>
      ) : null}

      {savedKey !== null ? (
        <FieldSet title="This Mac">
          <Row label="Saved key">
            <Text variant="small-mono" color="secondary">
              •••• {savedKey}
            </Text>
          </Row>
          <Row
            label="Activation"
            description={
              status.state === "network-error"
                ? `Last verified ${formatDate(status.lastValidatedAt)}.`
                : undefined
            }
          >
            <Status variant={licensed ? "success" : "warning"}>
              {licensed
                ? "Active on this Mac"
                : status.state === "network-error"
                  ? "Waiting to verify"
                  : "Not active"}
            </Status>
          </Row>
          <Row label="Macs per key">
            <Text variant="small" color="secondary">
              Up to {LICENSE_ACTIVATION_LIMIT} at once
            </Text>
          </Row>
          {licensed ? null : (
            <Row
              label="Remove this key"
              description="Takes the saved key off this Mac so you can start over."
            >
              <Button
                size="small"
                onClick={() => deactivate.mutate()}
                disabled={deactivate.isPending}
              >
                {deactivate.isPending ? "Removing…" : "Remove saved key"}
              </Button>
            </Row>
          )}
        </FieldSet>
      ) : null}

      {licensed ? (
        <FieldSet title="Included with Pro">
          <ProBenefits className="px-3 py-3" />
        </FieldSet>
      ) : null}

      {purchasable ? (
        <FieldSet title={licensed ? "Manage" : "Help"}>
          {licensed ? (
            <Row
              label="Move Pro to another Mac"
              description="Deactivating takes the key off this Mac and frees its slot. Keep your key handy to activate again."
            >
              <Button
                size="small"
                onClick={() => setConfirmingDeactivate(true)}
                disabled={deactivate.isPending}
              >
                {deactivate.isPending ? "Removing…" : "Deactivate this device"}
              </Button>
            </Row>
          ) : null}
          <Row
            label="License help"
            description={`Lost your key or can't activate? Email ${LICENSE_SUPPORT_EMAIL}.`}
          >
            <Button size="small" onClick={() => void sendFeedback()}>
              Email support…
            </Button>
            <Button size="small" variant="transparent" onClick={() => void copyFeedbackAddress()}>
              Copy address
            </Button>
          </Row>
        </FieldSet>
      ) : null}

      <AlertDialog
        open={confirmingDeactivate}
        onOpenChange={setConfirmingDeactivate}
        title={LICENSE_DEACTIVATE_COPY.title}
        description={LICENSE_DEACTIVATE_COPY.description}
        confirmLabel={LICENSE_DEACTIVATE_COPY.confirm}
        confirmVariant="destructive"
        onConfirm={() => deactivate.mutate()}
      />
      <AlertDialog
        open={confirmingReset}
        onOpenChange={setConfirmingReset}
        title={LICENSE_RESET_COPY.title}
        description={LICENSE_RESET_COPY.description}
        confirmLabel={LICENSE_RESET_COPY.confirm}
        confirmVariant="destructive"
        onConfirm={() => reset.mutate()}
      />
      <AlertDialog
        open={confirmingForget}
        onOpenChange={setConfirmingForget}
        title={LICENSE_FORGET_COPY.title}
        description={LICENSE_FORGET_COPY.description}
        confirmLabel={LICENSE_FORGET_COPY.confirm}
        confirmVariant="destructive"
        onConfirm={() => forget.mutate()}
      />
    </div>
  );
}
