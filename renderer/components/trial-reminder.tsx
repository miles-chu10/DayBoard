import { useState } from "react";
import { Sparkles } from "lucide-react";

import { Button, Callout, Text } from "../ui";
import { openExternal } from "../lib/ipc";
import {
  proBuyUrl,
  proPrice,
  trialReminderStage,
  useLicenseStatus,
  type TrialReminderStage,
} from "../lib/license";
import { readStored, writeStored } from "../lib/storage";
import { LICENSE_ACTIVATION_LIMIT } from "../../shared/license";

const DISMISSED_KEY = "home:trial-reminder:v1";
const isStage = (value: unknown): value is TrialReminderStage =>
  value === "3-days" || value === "last-day";

/**
 * Home's reminder that the AI trial is ending: once at 3 days left and once on the last day.
 * "Not now" hides it until the next one. Never shown with a license, after the trial or in demo.
 */
export function TrialReminder() {
  const { data } = useLicenseStatus();
  const [dismissed, setDismissed] = useState(() => readStored(DISMISSED_KEY, isStage));
  const stage = trialReminderStage(data?.status);
  const buyUrl = proBuyUrl(data?.checkoutUrl ?? "", "app-trial-reminder");
  if (!stage || stage === dismissed || !buyUrl || data?.status.state !== "trial") return null;

  const { daysLeft } = data.status;
  const { price, note } = proPrice();
  return (
    <Callout
      role="status"
      color="blue"
      className="text-primary"
      icon={<Sparkles className="text-support-blue" aria-hidden />}
      actions={
        <>
          <Button size="small" variant="accent" onClick={() => void openExternal(buyUrl)}>
            Get DayBoard Pro
          </Button>
          <Button
            size="small"
            variant="transparent"
            onClick={() => {
              setDismissed(stage);
              writeStored(DISMISSED_KEY, stage);
            }}
          >
            Not now
          </Button>
        </>
      }
    >
      <Text as="span" className="font-semibold">
        {daysLeft <= 1 ? "Last day of your AI trial." : `${daysLeft} days left in your AI trial.`}
      </Text>{" "}
      Keep the Assistant, Quick Capture AI and dictation with DayBoard Pro: {price} once
      {note ? " at the launch price" : ""}, on up to {LICENSE_ACTIVATION_LIMIT} Macs.
    </Callout>
  );
}
