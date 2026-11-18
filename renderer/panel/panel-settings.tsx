import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button,
  Kbd,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
} from "@renderer/ui";
import type { AppSettings, SourceId } from "@main/shared-types";

import { SourceDot } from "../components/source-dot";
import { openSettings } from "../lib/ipc";
import { sourceOn } from "../lib/settings";
import { SOURCE_META } from "../lib/sources";
import type { TargetOption } from "./capture-target";
import type { PanelPrefs } from "./panel-prefs";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <Text as="h3" variant="small-strong" color="secondary" className="px-2">
        {title}
      </Text>
      <div className="flex flex-col rounded-xl bg-well px-2.5 py-1">{children}</div>
    </section>
  );
}

function Row({
  label,
  detail,
  children,
}: {
  label: ReactNode;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center gap-2 py-1">
      <div className="min-w-0 flex-1">
        <Text as="p" variant="regular" className="flex items-center gap-2">
          {label}
        </Text>
        {detail ? (
          <Text as="p" variant="small" color="tertiary">
            {detail}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  );
}

const PANEL_SOURCES: { source: SourceId; pref: "calendar" | "tasks" | "reminders" | "mail" }[] = [
  { source: "calendar", pref: "calendar" },
  { source: "tasks", pref: "tasks" },
  { source: "reminders", pref: "reminders" },
  { source: "mail", pref: "mail" },
];

export const PANEL_SHORTCUTS: [string, string][] = [
  ["Add", "↩"],
  ["Ask", "⌘↩"],
  ["Day, Lists, Month", "⌘1 ⌘2 ⌘3"],
  ["Sync", "⌘R"],
  ["Panel settings", "⌘,"],
  ["Back, then close", "Esc"],
  ["Quit DayBoard", "⌘Q"],
];

/** The panel's own settings, inside the panel. Accounts, AI and the license live in Settings. */
export function PanelSettings({
  settings,
  prefs,
  onPrefs,
  destinations,
  destination,
  onDestination,
  quickCaptureKeys,
  onSync,
  onQuit,
  onClose,
}: {
  settings: AppSettings | undefined;
  prefs: PanelPrefs;
  onPrefs: (patch: Partial<PanelPrefs>) => void;
  destinations: TargetOption[];
  destination: TargetOption | null;
  onDestination: (key: string) => void;
  quickCaptureKeys: string | null;
  onSync: () => void;
  onQuit: () => void;
  onClose: () => void;
}) {
  return (
    <section aria-label="Panel settings" className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <Text as="h2" variant="small-strong" className="flex-1">
          Panel settings
        </Text>
        <Button size="small" variant="transparent" onClick={onClose}>
          Done
        </Button>
      </div>

      <Group title="Show in the menu bar">
        {PANEL_SOURCES.map(({ source, pref }) => {
          const on = sourceOn(settings, source);
          const label = source === "mail" ? "Mail waiting on you" : SOURCE_META[source].label;
          return (
            <Row
              key={source}
              label={
                <>
                  <SourceDot source={source} />
                  {label}
                </>
              }
              detail={on ? undefined : "Turned off in DayBoard’s Settings"}
            >
              <Switch
                aria-label={label}
                disabled={!on}
                checked={on && prefs[pref]}
                onCheckedChange={(checked) => onPrefs({ [pref]: checked })}
              />
            </Row>
          );
        })}
        <Row label="Checked off today" detail="Keep finished to-dos on the day’s line">
          <Switch
            aria-label="Checked off today"
            checked={prefs.completed}
            onCheckedChange={(checked) => onPrefs({ completed: checked })}
          />
        </Row>
      </Group>

      <Group title="Adding">
        <Row label="New items go to">
          {destinations.length ? (
            <Select value={destination?.key} onValueChange={onDestination}>
              <SelectTrigger size="small" aria-label="New items go to" className="max-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Text as="span" variant="small" color="tertiary">
              No list connected
            </Text>
          )}
        </Row>
        <Row label="Quick Capture" detail="Add from anywhere on this Mac">
          <Text as="span" variant="small" color="secondary">
            {quickCaptureKeys ?? "Off"}
          </Text>
        </Row>
        <Row label="Sync now" detail="Re-read every source the panel shows">
          <Button size="small" onClick={onSync}>
            Sync
          </Button>
        </Row>
      </Group>

      <Group title="Keyboard shortcuts">
        {PANEL_SHORTCUTS.map(([label, keys]) => (
          <Row key={label} label={label}>
            <span className="flex gap-1">
              {keys.split(" ").map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          </Row>
        ))}
      </Group>

      <Group title="DayBoard">
        <button
          type="button"
          className="-mx-1 flex min-h-9 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          onClick={() => void openSettings()}
        >
          <span className="min-w-0 flex-1">
            <Text as="span" variant="regular" className="block">
              Accounts, AI and license
            </Text>
            <Text as="span" variant="small" color="tertiary" className="block">
              Opens the Settings window
            </Text>
          </span>
          <ChevronRight className="size-4 text-tertiary" aria-hidden="true" />
        </button>
        <Row label="Quit DayBoard">
          <Button size="small" onClick={onQuit}>
            Quit
          </Button>
        </Row>
      </Group>
    </section>
  );
}
