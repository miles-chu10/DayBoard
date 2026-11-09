import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Sparkles } from "lucide-react";
import {
  Button,
  Callout,
  DialogContent,
  DialogTitle,
  Dialog,
  KeyCaps,
  Status,
  Switch,
  Text,
} from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import type { AIProvider, CliProviderId, ProviderStatus, SourceId } from "@main/shared-types";

import appIcon from "../../app-icon.png";
import { acceleratorKeys } from "@shared/accelerator";
import { FEEDBACK_EMAIL } from "@shared/feedback";
import { isRendererDemoMode } from "../lib/demo";
import { sendFeedback } from "../lib/feedback";
import { invoke, openSettings } from "../lib/ipc";
import { useLicenseStatus } from "../lib/license";
import {
  aiPlanCopy,
  ONBOARDING_STEPS,
  providerIndicator,
  type OnboardingStep,
} from "../lib/onboarding";
import { useAccounts, useConnectGoogle, useRequestRemindersAccess } from "../lib/queries";
import {
  PROVIDER_DETAIL,
  PROVIDER_LABEL,
  SUBSCRIPTION_PROVIDERS,
  useSettingsEditor,
} from "../lib/settings";
import { shortcutKeys, SHORTCUTS } from "../lib/shortcuts";
import { useStartAtLogin } from "../lib/use-start-at-login";
import { ProviderMark } from "./provider-logo";
import { SourceIcon } from "./source-dot";
import { AppleRemindersLogo, GmailLogo, GoogleCalendarLogo, GoogleTasksLogo } from "./source-logos";
import "./onboarding.css";

type Direction = "forward" | "back" | "none";

/**
 * The first-run welcome: what DayBoard is, connecting Google and Reminders, choosing an AI
 * provider and the shortcuts worth knowing. Every step is optional; closing it at any point
 * counts as done (Help → Welcome to DayBoard… shows it again). Mount it to show it, so each
 * showing starts at the first step.
 *
 * Beside the steps, an example day fills in with each source as it's connected, so the person
 * sees what each step adds.
 */
export function OnboardingDialog({ onDone }: { onDone: () => void }) {
  const { settings, edit } = useSettingsEditor();
  const [step, setStep] = React.useState<OnboardingStep>("welcome");
  const [direction, setDirection] = React.useState<Direction>("none");
  const [choice, setChoice] = React.useState<AIProvider | "">("");
  const index = ONBOARDING_STEPS.indexOf(step);
  const current = settings?.ai.enabled && settings.ai.providerChosen ? settings.ai.provider : "";
  // AI turns on only with a tool that's installed: an AI feature that runs (such as sorting new
  // mail) starts the trial, so a missing tool would spend trial days on errors.
  const ready =
    useProviderStatus(isSubscriptionProvider(choice) ? choice : undefined).data?.ok === true;

  function goTo(target: OnboardingStep) {
    // The AI step starts on the provider already in use, if any.
    if (target === "ai") setChoice(current);
    setDirection(ONBOARDING_STEPS.indexOf(target) < index ? "back" : "forward");
    setStep(target);
  }
  const next = () => goTo(ONBOARDING_STEPS[index + 1] ?? "done");
  const back = () => goTo(ONBOARDING_STEPS[index - 1] ?? "welcome");

  function turnOnAi() {
    if (!choice || !ready) return;
    edit((draft) => {
      draft.ai.provider = choice;
      draft.ai.providerChosen = true;
      draft.ai.enabled = true;
    });
    next();
  }

  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onDone())}>
      <DialogContent
        aria-describedby={undefined}
        onPointerDownOutside={(event) => event.preventDefault()}
        // Focus the dialog itself, not "Skip setup", so nothing shows a focus ring on launch;
        // Tab still reaches every button.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        className={cn(
          "onboarding grid h-[min(86vh,32rem)] w-[min(92vw,52rem)] max-h-none overflow-hidden outline-none",
          "grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]",
        )}
      >
        <div className="flex min-h-0 flex-col">
          <StepProgress index={index} />
          <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-7 pt-5 pb-4">
            <div
              key={step}
              className="onboarding-step flex min-h-full flex-col"
              data-direction={direction}
            >
              {step === "welcome" ? <WelcomeStep /> : null}
              {step === "connect" ? <ConnectStep /> : null}
              {step === "ai" ? <AiStep choice={choice} onChoice={setChoice} /> : null}
              {step === "done" ? <DoneStep /> : null}
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-separator px-5 py-3">
            {step === "done" ? null : (
              <Button variant="transparent" onClick={onDone}>
                Skip setup
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {index > 0 ? <Button onClick={back}>Back</Button> : null}
              {step === "welcome" || step === "connect" ? (
                <Button variant="accent" onClick={next}>
                  {step === "welcome" ? "Get started" : "Continue"}
                </Button>
              ) : step === "ai" && choice && choice !== current ? (
                <>
                  <Button onClick={next}>Not now</Button>
                  <Button variant="accent" onClick={turnOnAi} disabled={!ready}>
                    Turn on AI
                  </Button>
                </>
              ) : step === "ai" ? (
                <Button variant="accent" onClick={next}>
                  Continue
                </Button>
              ) : (
                <Button variant="accent" onClick={onDone}>
                  Start using DayBoard
                </Button>
              )}
            </div>
          </div>
        </div>
        <DayPreview step={step} assistant={choice || current} />
      </DialogContent>
    </Dialog>
  );
}

function StepProgress({ index }: { index: number }) {
  return (
    <div className="px-7 pt-6">
      <span className="sr-only">
        Step {index + 1} of {ONBOARDING_STEPS.length}
      </span>
      <div className="flex gap-1.5" aria-hidden="true">
        {ONBOARDING_STEPS.map((item, position) => (
          <span
            key={item}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-[250ms]",
              position <= index ? "bg-accent" : "bg-control",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function StepHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-1.5">
      <DialogTitle className="text-heading1">{title}</DialogTitle>
      {children ? (
        <Text as="p" color="secondary">
          {children}
        </Text>
      ) : null}
    </div>
  );
}

function WelcomeStep() {
  return (
    <div className="onboarding-texts my-auto flex flex-col items-start gap-3 pb-4">
      <img src={appIcon} alt="" className="-ml-1.5 size-16" draggable={false} />
      <DialogTitle className="text-heading1">Welcome to DayBoard</DialogTitle>
      <Text as="p" variant="large" color="secondary" className="max-w-[34ch]">
        Your Google Tasks, Apple Reminders, Gmail and Google Calendar, together on one agenda.
      </Text>
      <Text as="p" color="tertiary" className="mt-3 max-w-[44ch]">
        There’s no DayBoard account to create. Your calendar, tasks, reminders and mail go straight
        from Google and Apple to this Mac, and every step here is optional.
      </Text>
    </div>
  );
}

/** The 28px icon tile that marks an account or provider in a row. */
function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center gap-0.5 rounded-lg border border-separator bg-background">
      {children}
    </span>
  );
}

function AccountRow({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-well px-3.5 py-3">
      <IconTile>{icon}</IconTile>
      <div className="flex min-w-0 flex-1 flex-col">
        <Text variant="strong">{title}</Text>
        <Text variant="small" color="secondary">
          {description}
        </Text>
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

function SuccessCheck({ className }: { className?: string }) {
  return (
    <span className={cn("onboarding-check", className)} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" className="size-full">
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.16" />
        <path
          d="M7.5 12.4l3 3 6-6.3"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Connected({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-small font-medium text-support-green">
      <SuccessCheck className="size-4" />
      {children}
    </span>
  );
}

function ConnectStep() {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data;
  // A failed check shouldn't read as "Checking…" forever; Settings → Sources can retry.
  const checking = accountsQuery.isError ? (
    <Status variant="neutral">Couldn’t check</Status>
  ) : (
    <Status variant="loading">Checking…</Status>
  );
  const connect = useConnectGoogle();
  const requestReminders = useRequestRemindersAccess();
  const google = accounts?.google;
  const reminders = accounts?.reminders;

  return (
    <>
      <StepHeading title="Connect your accounts">
        Both are optional. You can change them later in Settings → Sources.
      </StepHeading>
      <div className="flex flex-col gap-2">
        <AccountRow
          icon={
            <>
              <GoogleTasksLogo className="size-3 text-support-blue" />
              <GmailLogo className="size-3 text-support-red" />
              <GoogleCalendarLogo className="size-3 text-support-green" />
            </>
          }
          title="Google"
          description={
            google?.connected
              ? (google.email ?? "Signed in")
              : google && !google.hasCredentials
                ? "Google sign-in isn’t available in this build."
                : "Tasks, Gmail and Calendar. You finish signing in in your browser."
          }
        >
          {!google ? (
            checking
          ) : google.connected ? (
            <Connected>Connected</Connected>
          ) : google.hasCredentials ? (
            <Button
              size="small"
              variant="accent"
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
            >
              {connect.isPending ? "Waiting for Browser…" : "Sign in with Google"}
            </Button>
          ) : (
            <Status variant="neutral">Unavailable</Status>
          )}
        </AccountRow>
        <AccountRow
          icon={<AppleRemindersLogo className="size-4 text-support-orange" />}
          title="Apple Reminders"
          description={
            reminders === "denied" || reminders === "restricted"
              ? "Turn on access in System Settings → Privacy & Security → Reminders."
              : "Your lists from the Reminders app. macOS asks once."
          }
        >
          {reminders === undefined ? (
            checking
          ) : reminders === "full-access" ? (
            <Connected>Allowed</Connected>
          ) : reminders === "not-determined" ? (
            <Button
              size="small"
              onClick={() => requestReminders.mutate()}
              disabled={requestReminders.isPending}
            >
              Allow Access
            </Button>
          ) : (
            <Button size="small" onClick={() => void invoke("reminders:openSettings")}>
              Open Privacy Settings
            </Button>
          )}
        </AccountRow>
      </div>
    </>
  );
}

function isSubscriptionProvider(provider: AIProvider | ""): provider is CliProviderId {
  return (SUBSCRIPTION_PROVIDERS as readonly string[]).includes(provider);
}

/** Whether a provider's command-line tool is installed; the same query as Settings → AI. */
function useProviderStatus(provider: CliProviderId | undefined) {
  return useQuery({
    queryKey: ["provider-status", provider],
    queryFn: () => invoke<ProviderStatus>("ai:providerStatus", { provider, verify: false }),
    enabled: provider !== undefined,
    staleTime: 60_000,
  });
}

function AiStep({
  choice,
  onChoice,
}: {
  choice: AIProvider | "";
  onChoice: (provider: AIProvider) => void;
}) {
  const plan = aiPlanCopy(useLicenseStatus().data?.status);
  const selected = isSubscriptionProvider(choice) ? choice : undefined;
  const selectedStatus = useProviderStatus(selected).data;

  return (
    <>
      <StepHeading title="Set up AI (optional)">
        {SUBSCRIPTION_PROVIDERS.length > 0
          ? "DayBoard’s AI runs on a subscription you already have, through its command-line tool on this Mac. No API keys needed."
          : "Choose an AI provider and add its API key in Settings → AI."}
      </StepHeading>
      {SUBSCRIPTION_PROVIDERS.length > 0 ? (
        <RadioGroupPrimitive.Root
          aria-label="AI provider"
          value={choice}
          onValueChange={(value) => onChoice(value as AIProvider)}
          className="grid grid-cols-2 gap-2"
        >
          {SUBSCRIPTION_PROVIDERS.map((provider) => (
            <ProviderChoice key={provider} provider={provider} />
          ))}
        </RadioGroupPrimitive.Root>
      ) : null}
      <div className="mt-2 flex min-h-8 items-center justify-between gap-3">
        <Text variant="small" color="secondary" className="min-w-0">
          {selected
            ? selectedStatus && !selectedStatus.ok
              ? selectedStatus.message
              : PROVIDER_DETAIL[selected]
            : null}
        </Text>
        <Button
          size="small"
          variant="transparent"
          className="-mr-2.5 shrink-0"
          onClick={() => void openSettings("ai")}
        >
          {SUBSCRIPTION_PROVIDERS.length > 0 ? "Use an API key instead…" : "Open AI Settings…"}
        </Button>
      </div>
      {plan ? (
        <Callout color="secondary" icon={<Sparkles />} className="mt-2">
          {plan}
        </Callout>
      ) : null}
    </>
  );
}

function ProviderChoice({ provider }: { provider: CliProviderId }) {
  const status = useProviderStatus(provider).data;
  const indicator = providerIndicator(status);
  return (
    <RadioGroupPrimitive.Item
      value={provider}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border border-separator bg-background px-3 py-2.5 text-left",
        "transition-[border-color,background-color,box-shadow] duration-150",
        "hover:bg-list-hover",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent-5 data-[state=checked]:shadow-[inset_0_0_0_1px_var(--color-accent)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      )}
    >
      <IconTile>
        <ProviderMark provider={provider} className="size-4" />
      </IconTile>
      <span className="flex min-w-0 flex-col gap-0.5">
        <Text variant="strong" truncate>
          {PROVIDER_LABEL[provider]}
        </Text>
        <Status variant={indicator.variant}>{indicator.text}</Status>
      </span>
    </RadioGroupPrimitive.Item>
  );
}

function DoneStep() {
  const { settings } = useSettingsEditor();
  const login = useStartAtLogin();
  const quickCapture = settings?.system.quickCapture;
  const demo = isRendererDemoMode();

  return (
    <>
      <StepHeading title="You’re all set">
        A few shortcuts make DayBoard faster. Press ? any time to see them all.
      </StepHeading>
      <ul className="flex flex-col rounded-xl bg-well px-3.5 py-1">
        {quickCapture?.enabled ? (
          <ShortcutRow
            title="Quick Capture from any app"
            keys={acceleratorKeys(quickCapture.hotkey)}
          />
        ) : null}
        <ShortcutRow title="Search and jump anywhere" keys={shortcutKeys(SHORTCUTS.commandMenu)} />
        <ShortcutRow title="All keyboard shortcuts" keys={["?"]} />
        {demo ? null : (
          <li className="flex items-center justify-between gap-3 py-2.5">
            <Text id="onboarding-login-label">Open DayBoard when you log in</Text>
            <Switch
              aria-labelledby="onboarding-login-label"
              checked={login.data?.openAtLogin ?? false}
              disabled={!login.data || login.setOpenAtLogin.isPending}
              onCheckedChange={(checked) => login.setOpenAtLogin.mutate(checked)}
            />
          </li>
        )}
      </ul>
      {settings?.system.menuBar.enabled ? (
        <Text as="p" variant="small" color="secondary" className="mt-2.5">
          Today’s agenda is in the menu bar, too.
        </Text>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-4">
        <Text as="p" variant="small" color="secondary">
          Questions, bugs or ideas? Send Feedback starts an email to {FEEDBACK_EMAIL} with your
          DayBoard and macOS versions filled in. It’s also in the Help menu.
        </Text>
        <Button size="small" className="shrink-0" onClick={() => void sendFeedback()}>
          Send Feedback…
        </Button>
      </div>
    </>
  );
}

function ShortcutRow({ title, keys }: { title: string; keys: string[] }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-separator py-2.5">
      <Text>{title}</Text>
      <KeyCaps keys={keys} />
    </li>
  );
}

interface ExampleItem {
  source: SourceId;
  title: string;
  meta: string;
  account: "google" | "reminders";
}

/** Fictional items: the welcome shows what a day looks like before anything is connected. */
const EXAMPLE_DAY: ExampleItem[] = [
  { source: "calendar", title: "Design review", meta: "9:30 AM", account: "google" },
  {
    source: "mail",
    title: "Contract redlines from Jordan",
    meta: "Waiting on you",
    account: "google",
  },
  { source: "tasks", title: "Send the Q4 plan", meta: "Due today", account: "google" },
  { source: "reminders", title: "Pick up dry cleaning", meta: "6:00 PM", account: "reminders" },
];

/**
 * An example day beside the steps. On the welcome it's all there; from the accounts step on, a
 * source fills in once it's connected, so skipping one shows what's missing.
 */
function DayPreview({ step, assistant }: { step: OnboardingStep; assistant: AIProvider | "" }) {
  const accounts = useAccounts().data;
  const today = React.useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    [],
  );
  const connected = {
    google: Boolean(accounts?.google.connected),
    reminders: accounts?.reminders === "full-access",
  };
  const showAll = step === "welcome";
  const showAssistant = step === "ai" || step === "done";

  return (
    <aside
      aria-label="Example day"
      className="flex min-h-0 flex-col justify-center gap-3 border-l border-separator bg-background-secondary px-6 py-6"
    >
      <Text variant="small" color="tertiary">
        {showAll ? "An example day" : "Your day, as you set it up"}
      </Text>
      <div className="rounded-xl border border-separator bg-background p-3 shadow-[0_1px_2px_rgb(0_0_0/0.06)]">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <div className="flex flex-col">
            <Text variant="strong">Today</Text>
            <Text variant="small" color="tertiary">
              {today}
            </Text>
          </div>
          {step === "done" ? <SuccessCheck className="size-5 text-support-green" /> : null}
        </div>
        <ul className="flex flex-col">
          {EXAMPLE_DAY.map((item, order) =>
            showAll || connected[item.account] ? (
              <li
                key={`${item.source}-shown`}
                className="onboarding-row flex items-center gap-2.5 rounded-lg px-1 py-2"
                style={{ "--onboarding-order": order } as React.CSSProperties}
              >
                <SourceIcon source={item.source} />
                <Text className="min-w-0 flex-1" truncate>
                  {item.title}
                </Text>
                <Text variant="small" color="tertiary" className="shrink-0">
                  {item.meta}
                </Text>
              </li>
            ) : (
              <li
                key={`${item.source}-missing`}
                className="onboarding-row my-0.5 flex items-center gap-2.5 rounded-lg border border-dashed border-separator px-2 py-1.5"
              >
                <SourceIcon source={item.source} className="opacity-50" />
                <span className="h-1.5 flex-1 rounded-full bg-control" aria-hidden="true" />
                <Text variant="small" color="tertiary" className="shrink-0">
                  {item.account === "google" ? "Connect Google" : "Allow Reminders"}
                </Text>
              </li>
            ),
          )}
        </ul>
      </div>
      {/* Held open on every step so the day stays put when the Assistant appears. */}
      <div className="min-h-[6.5rem]">
        {showAssistant ? <AssistantNote provider={assistant} /> : null}
      </div>
    </aside>
  );
}

function AssistantNote({ provider }: { provider: AIProvider | "" }) {
  if (!provider)
    return (
      <div className="onboarding-row flex items-center gap-2.5 rounded-xl border border-dashed border-separator px-3 py-2.5">
        <Sparkles className="size-4 shrink-0 text-tertiary" aria-hidden="true" />
        <Text variant="small" color="tertiary">
          With AI on, the Assistant sums up your day and drafts replies.
        </Text>
      </div>
    );
  return (
    <div
      key={provider}
      className="onboarding-row flex flex-col gap-1.5 rounded-xl border border-separator bg-background px-3 py-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
    >
      <span className="flex items-center gap-1.5">
        <ProviderMark provider={provider} className="size-3.5" />
        <Text variant="small" color="secondary">
          Assistant
        </Text>
      </span>
      <Text>
        Your design review is at 9:30, and Jordan is waiting on the contract redlines. Want a draft
        reply?
      </Text>
    </div>
  );
}
