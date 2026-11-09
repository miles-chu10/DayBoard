import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import {
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
  Text,
} from "@renderer/ui";

/**
 * Google Calendar-style summary row: all overdue items collapse into one line above the day.
 * Pass `open`/`onOpenChange` to control it (Home remembers the choice); leave them out and it
 * starts collapsed each time (the Agenda page).
 */
export function OverdueSummary({
  count,
  open,
  onOpenChange,
  children,
}: {
  count: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <CollapsibleRoot open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="w-full rounded-md px-2 min-h-[var(--density-row)] hover:bg-list-hover">
        <CollapsibleChevron />
        <CircleAlert className="size-4 shrink-0 text-support-red" aria-hidden="true" />
        <Text variant="strong">
          {count} overdue {count === 1 ? "task" : "tasks"}
        </Text>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-1">{children}</div>
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}
