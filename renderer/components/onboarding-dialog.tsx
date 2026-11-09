import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import {
  Button,
  Callout,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Dialog,
  KeyCaps,
  Label,
  RadioGroup,
  RadioGroupItem,
  Status,
  Switch,
  Text,
} from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import type { AIProvider, CliProviderId, ProviderStatus } from "@main/shared-types";

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
import { AppleRemindersLogo, GmailLogo, GoogleCalendarLogo, GoogleTasksLogo } from "./source-logos";

/**
 * The first-run welcome: what DayBoard is, connecting Google and Reminders, choosing an AI
 * provider and the shortcuts worth knowing. Every step is optional; closing it at any point
 * counts as done (Help → Welcome to DayBoard… shows it again). Mount it to show it, so each
 * showing starts at the first step.
 */
export function OnboardingDialog({ onDone }: { onDone: () => void }) {
  const { settings, edit } = useSettingsEditor();
  const [step, setStep] = React.useState<OnboardingStep>("welcome");
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
        size="large"
        aria-describedby={undefined}
        onPointerDownOutside={(event) => event.preventDefault()}
        // Focus the dialog itself, not "Skip setup", so nothing shows a focus ring on launch;
        // Tab still reaches every button.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        className="overflow-hidden outline-none"
      >
        <div className="flex justify-center gap-1.5 pt-4" aria-hidden="true">
          {ONBOARDING_STEPS.map((item, position) => (
            <span
              key={item}
              className={cn(
                "size-1.5 rounded-full",
                position === index ? "bg-accent" : "bg-control",
              )}
            />
          ))}
        </div>
        <div className="min-h-0 overflow-y-auto px-6 pt-3 pb-5">
          {step === "welcome" ? <WelcomeStep /> : null}
          {step === "connect" ? <ConnectStep /> : null}
          {step === "ai" ? <AiStep choice={choice} onChoice={setChoice} /> : null}
          {step === "done" ? <DoneStep /> : null}
        </div>
        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-1">
      <DialogTitle variant="heading2">{title}</DialogTitle>
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
    <div className="flex flex-col items-center text-center">
      <img src={appIcon} alt="" className="mb-3 size-20" draggable={false} />
      <DialogTitle variant="heading2">Welcome to DayBoard</DialogTitle>
      <Text as="p" color="secondary" className="mt-1 max-w-sm">
        Your tasks, reminders, mail and calendar on one dashboard, with an AI assistant when you
        want one.
      </Text>
      <div className="mt-4 flex items-center gap-3 text-secondary" aria-hidden="true">
        <GoogleTasksLogo className="size-5 text-support-blue" />
        <AppleRemindersLogo className="size-5 text-support-orange" />
        <GmailLogo className="size-5 text-support-red" />
        <GoogleCalendarLogo className="size-5 text-support-green" />
      </div>
      <Text as="p" variant="small" color="tertiary" className="mt-5 max-w-sm">
        There’s no DayBoard account to create. DayBoard has no server that receives your calendar,
        tasks, reminders or mail.
      </Text>
    </div>
  );
}

function Row({
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
    <div className="flex items-center gap-3 px-3 py-3">
      <div className="flex w-14 shrink-0 items-center justify-center gap-0.5">{icon}</div>
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
      <div className="divide-y divide-separator rounded-lg border border-separator">
        <Row
          icon={
            <>
              <GoogleTasksLogo className="size-4 text-support-blue" />
              <GmailLogo className="size-4 text-support-red" />
              <GoogleCalendarLogo className="size-4 text-support-green" />
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
            <Status variant="success">Connected</Status>
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
        </Row>
        <Row
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
            <Status variant="success">Allowed</Status>
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
        </Row>
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

  return (
    <>
      <StepHeading title="Set up AI (optional)">
        {SUBSCRIPTION_PROVIDERS.length > 0
          ? "DayBoard’s AI runs on the subscription you already have, through its official command-line tool on this Mac. No API keys needed."
          : "Choose an AI provider and add its API key in Settings → AI."}
      </StepHeading>
      {SUBSCRIPTION_PROVIDERS.length > 0 ? (
        <RadioGroup
          aria-label="AI provider"
          value={choice}
          onValueChange={(value) => onChoice(value as AIProvider)}
          className="gap-0 divide-y divide-separator rounded-lg border border-separator"
        >
          {SUBSCRIPTION_PROVIDERS.map((provider) => (
            <ProviderChoice key={provider} provider={provider} selected={choice === provider} />
          ))}
        </RadioGroup>
      ) : null}
      <Button
        size="small"
        variant="transparent"
        className="mt-2 -ml-2.5"
        onClick={() => void openSettings("ai")}
      >
        {SUBSCRIPTION_PROVIDERS.length > 0 ? "Use an API key instead…" : "Open AI Settings…"}
      </Button>
      {plan ? (
        <Callout color="secondary" icon={<Sparkles />} className="mt-3">
          {plan}
        </Callout>
      ) : null}
    </>
  );
}

function ProviderChoice({ provider, selected }: { provider: CliProviderId; selected: boolean }) {
  const status = useProviderStatus(provider).data;
  const indicator = providerIndicator(status);
  return (
    <Label className="items-start gap-3 px-3 py-2.5">
      <RadioGroupItem value={provider} className="mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <ProviderMark provider={provider} className="size-3.5" />
          <Text variant="strong">{PROVIDER_LABEL[provider]}</Text>
        </span>
        <Text variant="small" color="secondary">
          {selected && status && !status.ok ? status.message : PROVIDER_DETAIL[provider]}
        </Text>
      </span>
      <Status variant={indicator.variant} className="mt-0.5 shrink-0">
        {indicator.text}
      </Status>
    </Label>
  );
}

function DoneStep() {
  const { settings } = useSettingsEditor();
  const login = useStartAtLogin();
  const quickCapture = settings?.system.quickCapture;
  const demo = isRendererDemoMode();

  return (
    <>
      <StepHeading title="You’re all set">A few things worth knowing:</StepHeading>
      <ul className="divide-y divide-separator rounded-lg border border-separator">
        {quickCapture?.enabled ? (
          <ShortcutRow
            title="Quick Capture from any app"
            keys={acceleratorKeys(quickCapture.hotkey)}
          />
        ) : null}
        <ShortcutRow title="Search and jump anywhere" keys={shortcutKeys(SHORTCUTS.commandMenu)} />
        <ShortcutRow title="All keyboard shortcuts" keys={["?"]} />
        {settings?.system.menuBar.enabled ? (
          <li className="px-3 py-2.5">
            <Text>Today’s agenda is in the menu bar, too.</Text>
          </li>
        ) : null}
        {demo ? null : (
          <li className="flex items-center justify-between gap-3 px-3 py-2.5">
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
      <Callout
        color="secondary"
        className="mt-3"
        actions={
          <Button size="small" onClick={() => void sendFeedback()}>
            Send Feedback…
          </Button>
        }
      >
        Questions, bugs or ideas? Help → Send Feedback opens an email to {FEEDBACK_EMAIL} with your
        DayBoard and macOS versions filled in.
      </Callout>
    </>
  );
}

function ShortcutRow({ title, keys }: { title: string; keys: string[] }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2.5">
      <Text>{title}</Text>
      <KeyCaps keys={keys} />
    </li>
  );
}
