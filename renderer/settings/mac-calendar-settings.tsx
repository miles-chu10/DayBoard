import { Button, Field, FieldSet, Status, Switch } from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import type { MacCalendarInfo, RemindersAccess } from "@main/shared-types";

import { invoke } from "../lib/ipc";
import { useMacCalendars, useRequestCalendarAccess } from "../lib/queries";
import { useSettingsEditor } from "../lib/settings";
import { SettingSelect } from "./setting-select";

function accessStatus(access: RemindersAccess | undefined) {
  if (access === undefined)
    return { variant: "loading" as const, label: "Checking…", description: undefined };
  if (access === "full-access")
    return {
      variant: "success" as const,
      label: "Allowed",
      description: "Your iCloud calendars can appear on the dashboard.",
    };
  if (access === "not-determined")
    return {
      variant: "neutral" as const,
      label: "Not allowed",
      description: "Show and edit calendars from the Calendar app, such as iCloud calendars.",
    };
  return {
    variant: "warning" as const,
    label: "Off",
    description: "Turn on full access in System Settings → Privacy & Security → Calendars.",
  };
}

function calendarDetails(calendar: MacCalendarInfo): string | undefined {
  const details = [
    calendar.account,
    calendar.writable ? null : "Read-only",
    calendar.google ? "Also shown through Google Calendar" : null,
  ].filter(Boolean);
  return details.length ? details.join(" · ") : undefined;
}

function newEventOptions(
  calendars: MacCalendarInfo[],
  googleConnected: boolean,
  current: string,
): { value: string; label: string; sublabel?: string }[] {
  const options: { value: string; label: string; sublabel?: string }[] = [
    {
      value: "",
      label: "Automatically",
      sublabel: googleConnected ? "Google Calendar" : "The Calendar app's default calendar",
    },
  ];
  if (googleConnected || current === "google")
    options.push({ value: "google", label: "Google Calendar" });
  for (const calendar of calendars) {
    if (!calendar.writable) continue;
    options.push({
      value: calendar.id,
      label: calendar.name,
      sublabel: calendar.account ?? undefined,
    });
  }
  if (current && !options.some((option) => option.value === current))
    options.push({ value: current, label: "A calendar that's no longer available" });
  return options;
}

/** Calendar access, which Mac calendars appear, and where new events go. */
export function MacCalendarSettings({
  access,
  googleConnected,
}: {
  access: RemindersAccess | undefined;
  googleConnected: boolean;
}) {
  const { settings, edit } = useSettingsEditor();
  const request = useRequestCalendarAccess();
  const calendars = useMacCalendars(access === "full-access");
  const status = accessStatus(access);

  return (
    <FieldSet
      title="iCloud Calendars"
      description="Your iCloud calendars and any others in the Calendar app on this Mac. Show the ones you want and add or change events in them."
    >
      <Field label="Access" description={status.description}>
        <Status variant={status.variant}>{status.label}</Status>
      </Field>
      {access === "not-determined" ? (
        <Field>
          <Button onClick={() => request.mutate()} disabled={request.isPending}>
            Allow Access
          </Button>
        </Field>
      ) : access && access !== "full-access" ? (
        <Field>
          <Button onClick={() => void invoke("calendar:openSettings")}>
            Open Privacy Settings
          </Button>
        </Field>
      ) : null}
      {access !== "full-access" ? null : calendars.isPending || !settings ? (
        <Field label="Calendars">
          <Status variant="loading">Loading…</Status>
        </Field>
      ) : calendars.isError ? (
        <Field label="Calendars" description="Couldn't load your iCloud calendars.">
          <Button size="small" onClick={() => void calendars.refetch()}>
            Retry
          </Button>
        </Field>
      ) : calendars.data.calendars.length === 0 ? (
        <Field label="Calendars" description="The Calendar app has no calendars yet." />
      ) : (
        <>
          {calendars.data.calendars.map((calendar) => (
            <Field
              key={calendar.id}
              label={
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-block size-2.5 shrink-0 rounded-full",
                      !calendar.color && "bg-control",
                    )}
                    style={calendar.color ? { backgroundColor: calendar.color } : undefined}
                  />
                  <span className="truncate">{calendar.name}</span>
                </span>
              }
              description={calendarDetails(calendar)}
            >
              <Switch
                checked={settings.calendar.visibility[calendar.id] ?? calendar.defaultVisible}
                onCheckedChange={(checked) =>
                  edit((draft) => {
                    draft.calendar.visibility[calendar.id] = checked;
                  })
                }
                aria-label={`Show ${calendar.name}`}
              />
            </Field>
          ))}
          <Field
            label="New events go to"
            description="Where events you add in DayBoard, Quick Capture and MCP are saved."
          >
            <SettingSelect
              label="New events go to"
              value={settings.calendar.newEvents}
              options={newEventOptions(
                calendars.data.calendars,
                googleConnected,
                settings.calendar.newEvents,
              )}
              onChange={(value) =>
                edit((draft) => {
                  draft.calendar.newEvents = value;
                })
              }
            />
          </Field>
        </>
      )}
    </FieldSet>
  );
}
