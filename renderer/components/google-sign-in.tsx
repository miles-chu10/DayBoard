import * as React from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
} from "@renderer/ui";

import type { GoogleAccess } from "@main/shared-types";

import { openExternal } from "../lib/ipc";
import { useConnectGoogle } from "../lib/queries";

export const PRIVACY_POLICY_URL = "https://getdayboard.com/privacy.html";

const ACCESS_LABEL: Record<GoogleAccess, string> = {
  tasks: "Google Tasks",
  mail: "Gmail",
  calendar: "Google Calendar",
};

/** "Gmail is off because…" style sentence for permissions left unticked on Google's screen. */
export function missingAccessText(missing: readonly GoogleAccess[]): string {
  const names = missing.map((access) => ACCESS_LABEL[access]);
  const list =
    names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${list} ${names.length === 1 ? "is" : "are"} off because DayBoard wasn’t given permission.`;
}

/** Google's "G" mark. The colors and shape are fixed by Google's sign-in branding guidelines. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px] shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export interface GoogleSignInButtonProps extends Omit<React.ComponentProps<"button">, "children"> {
  /** Google allows only these wordings on a sign-in button. */
  label?: "Sign in with Google" | "Continue with Google";
}

/**
 * A sign-in button that follows Google's branding guidelines (light and dark themes): fixed
 * fill, stroke, text color, "G" mark and spacing. Don't restyle it with the app's button variants.
 */
export const GoogleSignInButton = React.forwardRef<HTMLButtonElement, GoogleSignInButtonProps>(
  ({ label = "Sign in with Google", className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2.5 rounded-full border px-3",
        "border-[#747775] bg-white text-[#1f1f1f] dark:border-[#8e918f] dark:bg-[#131314] dark:text-[#e3e3e3]",
        "text-[14px] font-medium leading-5 [font-family:Roboto,var(--font-sans)]",
        "outline-none focus-visible:ring-2 focus-visible:ring-[#4285f4] focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <GoogleMark />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  ),
);
GoogleSignInButton.displayName = "GoogleSignInButton";

/** What DayBoard asks Google for and does with it, shown before every Google sign-in. */
function GoogleDataDisclosure() {
  return (
    <div className="flex flex-col gap-3 text-regular text-secondary">
      <p>DayBoard will ask Google for permission to do the following:</p>
      <ul className="flex list-disc flex-col gap-1.5 pl-5">
        <li>
          <span className="font-medium text-primary">Calendar:</span> see your calendars, and see,
          add, edit and delete events.
        </li>
        <li>
          <span className="font-medium text-primary">Tasks:</span> see, add, edit, complete and
          delete your tasks.
        </li>
        <li>
          <span className="font-medium text-primary">Gmail:</span> read your mail, save reply
          drafts, archive messages and mark them read. DayBoard never sends or deletes mail,
          although Google’s screen describes this permission as read, compose and send.
        </li>
      </ul>
      <p>
        You can leave any of these unticked on Google’s screen. DayBoard turns off the parts it
        wasn’t given.
      </p>
      <p>
        Your Google data goes straight from Google to this Mac. DayBoard has no server, so nobody at
        DayBoard can see it. It is sent to an AI provider only if you turn on AI features in
        Settings, which are off until you do.
      </p>
      <p>
        <button
          type="button"
          className="text-accent underline underline-offset-2"
          onClick={() => void openExternal(PRIVACY_POLICY_URL)}
        >
          Read the privacy policy
        </button>
      </p>
    </div>
  );
}

export interface GoogleConnectProps {
  /**
   * The control that opens the disclosure. Defaults to the Google-branded button; pass a
   * render function for a different entry point (for example "Sign in again").
   */
  trigger?: (state: { open: () => void; pending: boolean }) => React.ReactNode;
  disabled?: boolean;
}

/**
 * Starts Google sign-in. Every entry point shows the data disclosure first, and the grant
 * itself always begins from the Google-branded button inside it.
 */
export function GoogleConnect({ trigger, disabled }: GoogleConnectProps) {
  const connect = useConnectGoogle();
  const [open, setOpen] = React.useState(false);
  const show = () => setOpen(true);

  return (
    <>
      {trigger ? (
        trigger({ open: show, pending: connect.isPending })
      ) : (
        <div className="flex flex-col items-start gap-1">
          <GoogleSignInButton onClick={show} disabled={disabled} />
          {connect.isPending ? (
            <span className="text-small text-secondary">
              Waiting for your browser. Click to start again.
            </span>
          ) : null}
        </div>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="medium" data-testid="google-disclosure">
          <AlertDialogHeader>
            <AlertDialogTitle>Before you sign in with Google</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              What DayBoard asks Google for and where that data goes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <GoogleDataDisclosure />
          <AlertDialogFooter className="justify-end">
            <AlertDialogCancel className="flex-none" />
            <GoogleSignInButton
              label="Continue with Google"
              onClick={() => {
                setOpen(false);
                connect.mutate();
              }}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Plain-button entry point for places where the account is already connected. */
export function GoogleReconnectButton({ label = "Sign in again" }: { label?: string }) {
  return (
    <GoogleConnect
      trigger={({ open, pending }) => (
        <Button onClick={open}>{pending ? "Restart Google sign-in" : label}</Button>
      )}
    />
  );
}
