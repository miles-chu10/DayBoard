import { History, Loader2 } from "lucide-react";
import { Button, Text } from "@renderer/ui";

import { savedCopyStatus, savedCopyTime } from "../lib/launch-cache";
import { useCalendar, useMail, useReminders, useTasks } from "../lib/queries";

/**
 * After a relaunch the dashboard first shows what the last session had. This line says so until
 * every source has refreshed, and offers a retry when a refresh fails.
 */
export function SavedCopyNotice() {
  const queries = [useTasks(), useReminders(), useMail(), useCalendar()];
  const status = savedCopyStatus(queries);
  if (!status) return null;
  const when = savedCopyTime(status.since);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-8 shrink-0 items-center gap-2 border-b border-separator bg-well px-4 py-1"
    >
      {status.refreshing ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-secondary" aria-hidden />
      ) : (
        <History className="size-3.5 shrink-0 text-secondary" aria-hidden />
      )}
      <Text variant="small" color={status.failed ? "orange" : "secondary"} className="min-w-0">
        {status.failed
          ? `Couldn’t refresh. Showing what DayBoard had at ${when}.`
          : `Showing what DayBoard had at ${when}. Refreshing…`}
      </Text>
      {status.failed ? (
        <Button
          size="small"
          className="ml-auto"
          onClick={() => {
            for (const query of queries) if (query.data?.state === "ok") void query.refetch();
          }}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}
