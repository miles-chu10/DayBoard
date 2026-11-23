import { Button, Field, FieldSet, Switch, Text, cn } from "@renderer/ui";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { SidebarView } from "@main/shared-types";

import { NAV_ITEMS, moveSidebarView, sidebarOrderRows } from "../lib/navigation";
import { sourceOn, useSettingsEditor } from "../lib/settings";

function title(id: SidebarView): string {
  return NAV_ITEMS.find((item) => item.id === id)?.title ?? id;
}

/** Settings → General → Sidebar: order, show or hide the main views, and their count pills. */
export function SidebarSettings() {
  const { settings, edit } = useSettingsEditor();
  if (!settings) return null;
  const { order, hidden, counts } = settings.general.sidebar;

  function move(id: SidebarView, delta: -1 | 1) {
    edit((draft) => {
      const { order: list, hidden: off } = draft.general.sidebar;
      draft.general.sidebar.order = [...moveSidebarView(list, off, id, delta)];
    });
  }

  function show(id: SidebarView, visible: boolean) {
    edit((draft) => {
      const rest = draft.general.sidebar.hidden.filter((item) => item !== id);
      draft.general.sidebar.hidden = visible ? rest : [...rest, id];
    });
  }

  return (
    <FieldSet
      title="Sidebar"
      description="Order the views and choose which appear. Calendar, Tasks and Reminders sit under Agenda. ⌃1–9 follow this order; hidden views stay in ⌘K."
    >
      <Field label="Show counts" orientation="horizontal">
        <Switch
          checked={counts}
          onCheckedChange={(checked) =>
            edit((draft) => {
              draft.general.sidebar.counts = checked;
            })
          }
          aria-label="Show counts"
        />
      </Field>
      <ul aria-label="Sidebar views" className="flex flex-col">
        {sidebarOrderRows(order, hidden).map(({ id, nested }) => {
          const name = title(id);
          const sourceOff =
            id !== "home" && id !== "agenda" && id !== "notes" && !sourceOn(settings, id);
          return (
            <li key={id}>
              <Field orientation="horizontal">
                <div className={cn("flex min-w-0 flex-col gap-0.5", nested && "pl-5")}>
                  <Text variant="regular">{name}</Text>
                  {sourceOff ? (
                    <Text variant="small" color="secondary">
                      Turned off in Sources
                    </Text>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    iconOnly
                    size="small"
                    variant="transparent"
                    aria-label={`Move ${name} up`}
                    disabled={moveSidebarView(order, hidden, id, -1) === order}
                    onClick={() => move(id, -1)}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    iconOnly
                    size="small"
                    variant="transparent"
                    aria-label={`Move ${name} down`}
                    disabled={moveSidebarView(order, hidden, id, 1) === order}
                    onClick={() => move(id, 1)}
                  >
                    <ChevronDown />
                  </Button>
                  <Switch
                    checked={!hidden.includes(id)}
                    disabled={id === "home"}
                    onCheckedChange={(visible) => show(id, visible)}
                    aria-label={`Show ${name}`}
                  />
                </div>
              </Field>
            </li>
          );
        })}
      </ul>
    </FieldSet>
  );
}
