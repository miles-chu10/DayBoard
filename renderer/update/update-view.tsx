import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Wrench, ListChecks } from "lucide-react";
import type { AppUpdateState, UpdateWindowState } from "@shared/app-updates";
import {
  CHANGELOG_URL,
  displayVersion,
  sectionTitle,
  type ReleaseNoteInline,
  type ReleaseNotes,
} from "@shared/release-notes";
import { Button, Callout, Checkbox } from "@renderer/ui";
import appIcon from "../../app-icon.png";
import { appUpdatesQueryKey, useAppUpdates } from "../lib/app-updates";
import { errorMessage, invoke, openExternal } from "../lib/ipc";

const windowKey = ["update-window"] as const;

function useWindowState() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: windowKey,
    queryFn: () => invoke<UpdateWindowState | null>("updates:window"),
    staleTime: Infinity,
  });
  useEffect(
    () =>
      window.dayboard.ipc.onNotification("updates:windowChanged", (state) =>
        client.setQueryData(windowKey, state as UpdateWindowState),
      ),
    [client],
  );
  return query.data;
}

export function UpdateView() {
  const windowState = useWindowState();
  const update = useAppUpdates().data;
  if (!windowState || !update) return null;
  return windowState.mode === "prompt" && windowState.version ? (
    <PromptView state={windowState} update={update} version={windowState.version} />
  ) : (
    <ProgressView update={update} />
  );
}

function Inline({ parts }: { parts: readonly ReleaseNoteInline[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "strong" ? (
          <strong key={index} className="font-semibold text-primary">
            {part.text}
          </strong>
        ) : part.kind === "code" ? (
          <code key={index} className="rounded bg-control-subtle px-1 font-mono text-[0.92em]">
            {part.text}
          </code>
        ) : part.kind === "link" ? (
          <button
            key={index}
            type="button"
            className="text-link underline-offset-2 hover:underline"
            onClick={() => void openExternal(part.href)}
          >
            {part.text}
          </button>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function NotesBody({ notes }: { notes: ReleaseNotes }) {
  return (
    <div className="space-y-4">
      <h2 className="text-large font-semibold text-primary">
        DayBoard {displayVersion(notes.version)}
        {notes.subtitle ? (
          <span className="block text-regular font-normal text-secondary">{notes.subtitle}</span>
        ) : null}
      </h2>
      {notes.summary.map((paragraph, index) => (
        <p key={index} className="text-regular text-secondary">
          <Inline parts={paragraph} />
        </p>
      ))}
      {notes.sections.map((section, index) => {
        const Icon =
          section.kind === "new" ? Sparkles : section.kind === "fixed" ? Wrench : ListChecks;
        return (
          <section key={index} className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-regular font-semibold text-primary">
              <Icon className="size-4 text-accent" aria-hidden />
              {sectionTitle(section)}
            </h3>
            {section.paragraphs.map((paragraph, p) => (
              <p key={p} className="text-regular text-secondary">
                <Inline parts={paragraph} />
              </p>
            ))}
            {section.items.length ? (
              <ul className="list-disc space-y-1.5 pl-5 text-regular text-secondary marker:text-tertiary">
                {section.items.map((item, i) => (
                  <li key={i}>
                    <Inline parts={item} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function PromptView({
  state,
  update,
  version,
}: {
  state: UpdateWindowState;
  update: AppUpdateState;
  version: string;
}) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [automatic, setAutomatic] = useState(state.preferences.automaticDownload);
  const notes = useQuery({
    queryKey: ["release-notes", version],
    queryFn: () => invoke<ReleaseNotes | null>("updates:releaseNotes", version),
    staleTime: Infinity,
  });
  const action = useMutation({
    mutationFn: (name: "skip" | "installOnQuit" | "installNow") =>
      name === "skip" ? invoke("updates:skip", version) : invoke(`updates:${name}`),
    onMutate: () => setError(null),
    onSuccess: () => void client.invalidateQueries({ queryKey: appUpdatesQueryKey }),
    onError: (cause) => setError(errorMessage(cause)),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => invoke("updates:setAutomaticDownload", enabled),
    onError: (cause, enabled) => {
      setAutomatic(!enabled);
      setError(errorMessage(cause));
    },
  });

  const downloaded = update.phase === "downloaded";
  const busy =
    action.isPending ||
    ["checking", "downloading", "preparing", "installing"].includes(update.phase);
  const name = displayVersion(version);
  return (
    <main className="flex h-screen flex-col gap-4 p-5 select-none">
      <header className="flex gap-4">
        <img src={appIcon} alt="" className="size-16 shrink-0" draggable={false} />
        <div className="min-w-0 pt-1">
          <h1 className="text-large font-semibold text-primary">
            {downloaded
              ? "A new version of DayBoard is ready to install!"
              : "A new version of DayBoard is available!"}
          </h1>
          <p className="mt-1 text-regular text-secondary">
            {downloaded
              ? `DayBoard ${name} has been downloaded and is ready to use. Would you like to install it and relaunch DayBoard now?`
              : `DayBoard ${name} is now available. You have ${displayVersion(update.currentVersion)}. Would you like to install it now?`}
          </p>
        </div>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-separator bg-well p-4 select-text"
        aria-label="Release notes"
        tabIndex={0}
      >
        {notes.isPending ? (
          <p className="text-regular text-secondary">Loading release notes…</p>
        ) : notes.data ? (
          <NotesBody notes={notes.data} />
        ) : (
          <p className="text-regular text-secondary">
            Release notes for {name} couldn’t be loaded.{" "}
            <button
              type="button"
              className="text-link hover:underline"
              onClick={() => void openExternal(CHANGELOG_URL)}
            >
              Read them on getdayboard.com
            </button>
          </p>
        )}
      </div>

      {error ? <Callout color="orange">{error}</Callout> : null}

      <label className="flex items-center gap-2 text-regular text-primary">
        <Checkbox
          checked={automatic}
          onCheckedChange={(value) => {
            const enabled = value === true;
            setAutomatic(enabled);
            toggle.mutate(enabled);
          }}
        />
        Automatically download and install updates in the future
      </label>

      <footer className="flex items-center gap-2">
        {downloaded ? null : (
          <Button size="large" radius="full" disabled={busy} onClick={() => action.mutate("skip")}>
            Skip This Version
          </Button>
        )}
        <span className="flex-1" />
        <Button
          size="large"
          radius="full"
          disabled={busy}
          onClick={() => action.mutate("installOnQuit")}
        >
          Install on Quit
        </Button>
        <Button
          size="large"
          radius="full"
          variant="accent"
          disabled={busy}
          onClick={() => action.mutate("installNow")}
        >
          Install and Relaunch
        </Button>
      </footer>
    </main>
  );
}

function ProgressView({ update }: { update: AppUpdateState }) {
  const client = useQueryClient();
  const install = useMutation({
    mutationFn: () => invoke<AppUpdateState>("updates:install"),
    onSuccess: (next) => client.setQueryData(appUpdatesQueryKey, next),
  });
  const close = () => void invoke("updates:closeWindow");

  let title: string;
  let detail: string | null = null;
  let percent: number | null = null;
  let button: { label: string; accent?: boolean; disabled?: boolean; run: () => void } | null =
    null;
  switch (update.phase) {
    case "checking":
    case "idle":
    case "available":
      title = "Checking for updates…";
      button = { label: "Cancel", run: close };
      break;
    case "downloading":
      title = "Downloading update…";
      percent = update.progressPercent ?? 0;
      break;
    case "downloaded":
      title = "Ready to Install";
      percent = 100;
      button = {
        label: "Install and Relaunch",
        accent: true,
        disabled: install.isPending,
        run: () => install.mutate(),
      };
      break;
    case "preparing":
    case "installing":
      title = "Installing update…";
      percent = 100;
      detail = update.message;
      break;
    case "up-to-date":
      title = "You’re up to date!";
      detail = `DayBoard ${displayVersion(update.currentVersion)} is the newest version available.`;
      button = { label: "OK", accent: true, run: close };
      break;
    case "unavailable":
      title = "Updates aren’t available";
      detail = update.message;
      button = { label: "OK", accent: true, run: close };
      break;
    default:
      title = "Update failed";
      detail = update.error ?? update.message;
      button = { label: "OK", accent: true, run: close };
  }
  const indeterminate = update.phase === "checking" || update.phase === "idle";

  return (
    <main className="flex h-screen gap-4 px-5 py-4 select-none">
      <img src={appIcon} alt="" className="size-16 shrink-0" draggable={false} />
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
        <h1 role="status" className="text-regular font-semibold text-primary">
          {title}
        </h1>
        {detail ? <p className="text-small text-secondary">{detail}</p> : null}
        {percent !== null || indeterminate ? (
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-control"
            role="progressbar"
            aria-label="Update progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminate ? undefined : Math.round(percent ?? 0)}
          >
            <div
              className={
                indeterminate
                  ? "h-full w-1/3 animate-pulse rounded-full bg-accent"
                  : "h-full rounded-full bg-accent transition-[width]"
              }
              style={indeterminate ? undefined : { width: `${percent}%` }}
            />
          </div>
        ) : null}
        {button ? (
          <div className="mt-auto flex justify-end">
            <Button
              size="large"
              radius="full"
              variant={button.accent ? "accent" : "filled"}
              disabled={button.disabled}
              onClick={button.run}
            >
              {button.label}
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
