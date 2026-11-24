import { useQuery } from "@tanstack/react-query";
import { CHANGELOG_URL, displayVersion } from "@shared/release-notes";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Status,
  Text,
} from "@renderer/ui";

import { openExternal } from "../lib/ipc";
import { loadWhatsNewNotes } from "../lib/whats-new";
import { NotesBody } from "./release-notes-body";

/** The running version's release notes, once after an update and from Help or Settings. */
export function WhatsNewDialog({ version, onClose }: { version: string; onClose: () => void }) {
  const notes = useQuery({
    queryKey: ["whats-new-notes", version],
    queryFn: () => loadWhatsNewNotes(version),
    staleTime: Infinity,
  });
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        size="large"
        {...(notes.data?.subtitle ? {} : { "aria-describedby": undefined })}
        // Focus the dialog itself, as the welcome does, so no button shows a focus ring on
        // launch; Tab still reaches both buttons and Escape closes it.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        className="outline-none"
      >
        <DialogHeader>
          <DialogTitle>{`What’s New in DayBoard ${displayVersion(version)}`}</DialogTitle>
          {notes.data?.subtitle ? (
            <DialogDescription>{notes.data.subtitle}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogBody>
          {notes.isPending ? (
            <Status variant="loading">Loading what’s new…</Status>
          ) : notes.data ? (
            <NotesBody notes={notes.data} heading={false} />
          ) : (
            <Text as="p" variant="regular" color="secondary">
              The notes for this version couldn’t be loaded. The full changelog is on
              getdayboard.com.
            </Text>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="filled" onClick={() => void openExternal(CHANGELOG_URL)}>
            Full Changelog
          </Button>
          <Button variant="accent" className="ml-auto" onClick={onClose}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
