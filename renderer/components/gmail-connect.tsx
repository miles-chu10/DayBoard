import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from "@renderer/ui";
import type { AccountsStatus } from "@main/shared-types";

import { errorMessage, invoke, openExternal } from "../lib/ipc";
import { queryKeys, useAccounts } from "../lib/queries";

export const APP_PASSWORDS_URL = "https://myaccount.google.com/apppasswords";
const TWO_STEP_URL = "https://myaccount.google.com/signinoptions/twosv";

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="text-accent underline underline-offset-2"
      onClick={() => void openExternal(href)}
    >
      {children}
    </button>
  );
}

export function useConnectGmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appPassword: string) => invoke<AccountsStatus>("gmail:connect", { appPassword }),
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.accounts, status);
      void queryClient.invalidateQueries();
      toast.success(
        status.gmail.email ? `Gmail connected for ${status.gmail.email}` : "Gmail connected",
      );
    },
  });
}

/**
 * Connects Gmail with an app password. Gmail is read over IMAP, as Apple Mail does, so DayBoard
 * needs no restricted Gmail permission from Google.
 */
export function GmailConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const accounts = useAccounts();
  const connect = useConnectGmail();
  const [password, setPassword] = React.useState("");
  const email = accounts.data?.google.email ?? null;

  const close = (next: boolean) => {
    if (!next) {
      setPassword("");
      connect.reset();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showCloseButton data-testid="gmail-connect">
        <DialogHeader>
          <DialogTitle variant="heading2">Connect Gmail</DialogTitle>
          <DialogDescription>
            DayBoard reads Gmail the way Apple Mail does, with an app password you make in your
            Google account{email ? ` for ${email}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (password.trim()) connect.mutate(password, { onSuccess: () => close(false) });
          }}
        >
          <DialogBody className="flex flex-col gap-3 text-regular text-secondary">
            <ol className="flex list-decimal flex-col gap-1.5 pl-5">
              <li>
                Turn on <LinkButton href={TWO_STEP_URL}>2-Step Verification</LinkButton> if it isn’t
                on already. Google offers app passwords only after that.
              </li>
              <li>
                Open <LinkButton href={APP_PASSWORDS_URL}>App passwords</LinkButton>
                {email ? ` while signed in as ${email}` : ""}, name it “DayBoard” and click Create.
              </li>
              <li>Paste the 16-letter password here.</li>
            </ol>
            <Input
              type="password"
              aria-label="App password"
              placeholder="abcd efgh ijkl mnop"
              autoComplete="off"
              spellCheck={false}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={connect.isPending}
              autoFocus
            />
            {connect.isError ? (
              <Callout color="red" role="alert">
                {errorMessage(connect.error)}
              </Callout>
            ) : null}
            <p className="text-small">
              The password is stored encrypted in your Mac’s Keychain, and your mail goes straight
              from Gmail to this Mac. Some work and school accounts don’t allow app passwords; ask
              your admin if the page says they aren’t available.
            </p>
          </DialogBody>
          <DialogFooter className="justify-end gap-2">
            <Button type="button" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="accent"
              disabled={!password.trim() || connect.isPending || !email}
            >
              {connect.isPending ? "Checking…" : "Connect Gmail"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A "Connect Gmail" button that opens the app password dialog. */
export function GmailConnect({ label = "Connect Gmail" }: { label?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      <GmailConnectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
