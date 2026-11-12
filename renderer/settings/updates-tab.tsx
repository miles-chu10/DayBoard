import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAppStoreBuild } from "@shared/app-store-build";
import type { AppUpdateState, UpdatePreferences } from "@shared/app-updates";
import { Button, Callout, Field, FieldSet, Status, Switch } from "../ui";
import { errorMessage, invoke } from "../lib/ipc";

import { appUpdatesQueryKey as queryKey, useAppUpdates } from "../lib/app-updates";

export function UpdatesTab() {
  const client = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const query = useAppUpdates();
  const action = useMutation({
    mutationFn: (name: "check" | "download" | "install") =>
      invoke<AppUpdateState>(`updates:${name}`),
    onMutate: () => setActionError(null),
    onSuccess: (state) => client.setQueryData(queryKey, state),
    onError: (error) => setActionError(errorMessage(error)),
  });

  const preferences = useQuery({
    queryKey: ["update-preferences"],
    queryFn: () => invoke<UpdatePreferences>("updates:preferences"),
  });
  const automatic = useMutation({
    mutationFn: (enabled: boolean) =>
      invoke<UpdatePreferences>("updates:setAutomaticDownload", enabled),
    onMutate: () => setActionError(null),
    onSuccess: (next) => client.setQueryData(["update-preferences"], next),
    onError: (error) => setActionError(errorMessage(error)),
  });

  const state = query.data;
  const busy =
    action.isPending ||
    ["checking", "downloading", "preparing", "installing"].includes(state?.phase ?? "");
  return (
    <FieldSet
      title="App updates"
      description={
        isAppStoreBuild
          ? "The Mac App Store installs DayBoard updates."
          : "DayBoard checks for updates in the background and shows what's new before installing."
      }
    >
      {query.isError ? (
        <Field>
          <Callout color="orange">Update status could not be read.</Callout>
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </Field>
      ) : !state ? (
        <Field>
          <Status variant="loading">Loading update status…</Status>
        </Field>
      ) : (
        <>
          <Field label="Installed version">
            <span>{state.currentVersion}</span>
          </Field>
          {state.phase === "unavailable" ? null : (
            <Field
              label="Download and install updates automatically"
              description="Updates download in the background and install when you quit DayBoard. When off, DayBoard asks first."
              orientation="horizontal"
            >
              <Switch
                checked={preferences.data?.automaticDownload ?? false}
                disabled={!preferences.data || automatic.isPending}
                onCheckedChange={(checked) => automatic.mutate(checked)}
                aria-label="Download and install updates automatically"
              />
            </Field>
          )}
          <Field>
            <p role="status" className="text-small text-secondary">
              {state.message}
            </p>
            {state.phase === "downloading" && state.progressPercent !== null ? (
              <progress
                aria-label="Update download"
                max={100}
                value={state.progressPercent}
                className="w-full"
              />
            ) : null}
            {state.error || actionError ? (
              <Callout color="orange">{state.error ?? actionError}</Callout>
            ) : null}
            {state.phase === "unavailable" ? null : state.phase === "downloaded" ? (
              <Button variant="accent" disabled={busy} onClick={() => action.mutate("install")}>
                Install and restart
              </Button>
            ) : state.phase === "available" ? (
              <Button variant="accent" disabled={busy} onClick={() => action.mutate("download")}>
                Download update
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => action.mutate("check")}>
                {busy ? "Working…" : "Check for updates"}
              </Button>
            )}
          </Field>
        </>
      )}
    </FieldSet>
  );
}
