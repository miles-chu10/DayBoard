import { app, clipboard, shell } from "../platform/index.js";
import { FEEDBACK_EMAIL, feedbackMailto } from "../../shared/feedback.js";

/** Opens a new email to support in the default mail app, with version details filled in. */
export function openFeedbackEmail(): Promise<void> {
  return shell.openExternal(
    feedbackMailto({
      appVersion: app.getVersion(),
      osVersion: process.getSystemVersion(),
      arch: process.arch,
    }),
  );
}

/** The app macOS will open for a new email, or "" when none is set. */
export function feedbackMailApp(): string {
  return app.getApplicationNameForProtocol("mailto:");
}

/** For testers whose mail is in a browser rather than a mail app. */
export function copyFeedbackAddress(): void {
  clipboard.writeText(FEEDBACK_EMAIL);
}
