import { useQuery } from "@tanstack/react-query";
import type { UsageCheckInStatus } from "@shared/usage-checkin";
import { Button, Field, FieldSet, Switch } from "../ui";
import { invoke, openExternal } from "../lib/ipc";
import { useSettingsEditor } from "../lib/settings";

const PRIVACY_URL = "https://getdayboard.com/privacy.html#checkin";

function lastSent(day: string | null): string {
  if (!day) return "Nothing sent yet.";
  const date = new Date(`${day}T12:00:00Z`);
  return `Last sent ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.`;
}

/** Shown only in builds that check in: official releases with the license service. */
export function UsageCheckInSettings() {
  const { settings, edit } = useSettingsEditor();
  const status = useQuery({
    queryKey: ["usage-checkin"],
    queryFn: () => invoke<UsageCheckInStatus>("usage:checkInStatus"),
  });
  if (!settings || !status.data?.available) return null;
  const enabled = settings.privacy.usageCheckIn;
  return (
    <FieldSet
      title="Usage check-in"
      description="Once a day, DayBoard tells its license service that it's in use, so we know how many people use it. It sends a random ID made only for this, the DayBoard version, and whether you're in the AI trial or have Pro. It never sends your calendar, tasks, reminders, mail, AI chats, Google account or license key."
    >
      <Field
        label="Send a daily anonymous check-in"
        description={enabled ? lastSent(status.data.lastSentDay) : "Off. Nothing is sent."}
      >
        <Switch
          checked={enabled}
          onCheckedChange={(checked) =>
            edit((draft) => {
              draft.privacy.usageCheckIn = checked;
            })
          }
          aria-label="Send a daily anonymous check-in"
        />
      </Field>
      <Field>
        <Button size="small" variant="transparent" onClick={() => void openExternal(PRIVACY_URL)}>
          Read the privacy policy
        </Button>
      </Field>
    </FieldSet>
  );
}
