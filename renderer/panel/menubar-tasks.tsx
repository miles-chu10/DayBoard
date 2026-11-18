import { Plus } from "lucide-react";
import { useState } from "react";
import {
  Button,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
  Text,
} from "@renderer/ui";

import { SourceDot } from "../components/source-dot";
import { readStored, writeStored } from "../lib/storage";
import { TodoItem } from "./panel-rows";
import type { TaskGroup } from "./task-groups";

const COLLAPSED_LISTS_KEY = "menubar:collapsedLists:v1";
const isKeyList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((key) => typeof key === "string");

/**
 * Every open to-do, grouped by list, inside the menu bar. A list folds to its header (the panel
 * remembers which); its + aims the command bar at that list; each row opens in place.
 */
export function MenuBarTasks({
  groups,
  canAddTo,
  onAddTo,
}: {
  groups: TaskGroup[];
  /** Whether the command bar can write to this list right now. */
  canAddTo: (key: string) => boolean;
  onAddTo: (key: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(
    () => new Set(readStored(COLLAPSED_LISTS_KEY, isKeyList) ?? []),
  );
  const setOpen = (key: string, open: boolean) => {
    const next = new Set(collapsed);
    if (open) next.delete(key);
    else next.add(key);
    setCollapsed(next);
    writeStored(COLLAPSED_LISTS_KEY, [...next]);
  };

  return (
    <section aria-label="All tasks" className="flex flex-col gap-2">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.title} className="flex flex-col">
          <CollapsibleRoot
            open={!collapsed.has(group.key)}
            onOpenChange={(open) => setOpen(group.key, open)}
          >
            <div className="flex items-center gap-1">
              <CollapsibleTrigger
                aria-label={`${group.title}, ${group.rows.length} open`}
                className="min-w-0 flex-1 rounded-md px-2 py-0.5 hover:bg-list-hover"
              >
                <CollapsibleChevron />
                <SourceDot source={group.source} />
                <Text as="span" variant="small-strong" truncate className="min-w-0">
                  {group.title}
                </Text>
                <Text as="span" variant="small" color="tertiary" className="tabular-nums">
                  {group.rows.length}
                </Text>
              </CollapsibleTrigger>
              {canAddTo(group.key) ? (
                <Button
                  size="small"
                  variant="transparent"
                  iconOnly
                  aria-label={`Add to ${group.title}`}
                  title={`Add to “${group.title}”`}
                  onClick={() => onAddTo(group.key)}
                >
                  <Plus aria-hidden="true" />
                </Button>
              ) : null}
            </div>
            <CollapsibleContent>
              <ul className="flex flex-col">
                {group.rows.map(({ todo }) => (
                  <TodoItem key={todo.key} todo={todo} due plain />
                ))}
              </ul>
            </CollapsibleContent>
          </CollapsibleRoot>
        </section>
      ))}
    </section>
  );
}
