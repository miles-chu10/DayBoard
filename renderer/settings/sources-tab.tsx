import { Button, Field, FieldSet, Status, Switch } from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import type { SourceColor } from "@main/shared-types";

import { SourceHeading } from "../components/source-dot";
import { useAccounts, useCalendars, useConnectGoogle, useItemLists } from "../lib/queries";
import { useSettingsEditor } from "../lib/settings";
import { COLOR_OPTIONS, SOURCE_IDS, SOURCE_META } from "../lib/sources";
import { GoogleSettings, RemindersSettings } from "./account-settings";
import { SettingSelect } from "./setting-select";

function CalendarsSettings() {
  const { settings, edit } = useSettingsEditor();
  const calendars = useCalendars(true);
  const connect = useConnectGoogle();

  return (
    <FieldSet
      title="Google Calendars"
      description="Choose which of your calendars appear on the dashboard."
    >
      {calendars.isPending || !settings ? (
        <Field label="Calendars">
          <Status variant="loading">Loading…</Status>
        </Field>
      ) : calendars.isError ? (
        <Field label="Calendars" description="Couldn't load your calendar list.">
          <Button size="small" onClick={() => void calendars.refetch()}>
            Retry
          </Button>
        </Field>
      ) : calendars.data.limited ? (
        <Field
          label="Primary calendar only"
          description="Reconnect Google to grant access to your calendar list and choose other calendars."
        >
          <Button size="small" onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending ? "Waiting for Browser…" : "Reconnect"}
          </Button>
        </Field>
      ) : (
        calendars.data.calendars.map((calendar) => (
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
            description={calendar.primary ? "Primary calendar" : undefined}
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
        ))
      )}
    </FieldSet>
  );
}

function ListsSettings({ source }: { source: "tasks" | "reminders" }) {
  const { settings, edit } = useSettingsEditor();
  const lists = useItemLists(source, true);
  const label = source === "tasks" ? "Google Tasks Lists" : "Apple Reminders Lists";

  return (
    <FieldSet title={label} description="Choose which of your lists appear on the dashboard.">
      {lists.isPending || !settings ? (
        <Field label="Lists">
          <Status variant="loading">Loading…</Status>
        </Field>
      ) : lists.isError ? (
        <Field label="Lists" description="Couldn't load your lists.">
          <Button size="small" onClick={() => void lists.refetch()}>
            Retry
          </Button>
        </Field>
      ) : lists.data.length === 0 ? (
        <Field label="Lists" description="No lists found." />
      ) : (
        lists.data.map((list) => (
          <Field
            key={list.id}
            label={
              <span className="flex items-center gap-2 min-w-0">
                {list.color ? (
                  <span
                    aria-hidden="true"
                    className="inline-block size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: list.color }}
                  />
                ) : null}
                <span className="truncate">{list.title}</span>
              </span>
            }
          >
            <Switch
              checked={settings.lists[source][list.id] ?? true}
              onCheckedChange={(checked) =>
                edit((draft) => {
                  draft.lists[source][list.id] = checked;
                })
              }
              aria-label={`Show ${list.title}`}
            />
          </Field>
        ))
      )}
    </FieldSet>
  );
}

export function SourcesTab() {
  const { settings, edit } = useSettingsEditor();
  const accounts = useAccounts();

  return (
    <>
      <FieldSet
        title="DayBoard Sources"
        description="Choose what appears on your dashboard and the color that marks it everywhere."
      >
        {settings ? (
          SOURCE_IDS.map((id) => (
            <Field key={id} label={<SourceHeading source={id} />}>
              <div className="flex items-center gap-3">
                <SettingSelect
                  label={`${SOURCE_META[id].label} color`}
                  value={settings.sources[id].color}
                  options={COLOR_OPTIONS}
                  onChange={(value) =>
                    edit((draft) => {
                      draft.sources[id].color = value as SourceColor;
                    })
                  }
                />
                <Switch
                  checked={settings.sources[id].enabled}
                  onCheckedChange={(checked) =>
                    edit((draft) => {
                      draft.sources[id].enabled = checked;
                    })
                  }
                  aria-label={`Show ${SOURCE_META[id].label}`}
                />
              </div>
            </Field>
          ))
        ) : (
          <Field label="Sources">
            <Status variant="loading">Loading…</Status>
          </Field>
        )}
      </FieldSet>

      <GoogleSettings status={accounts.data?.google} />
      {accounts.data?.google.connected ? <CalendarsSettings /> : null}
      {accounts.data?.google.connected ? <ListsSettings source="tasks" /> : null}
      <RemindersSettings access={accounts.data?.reminders} />
      {accounts.data?.reminders === "full-access" ? <ListsSettings source="reminders" /> : null}
    </>
  );
}
