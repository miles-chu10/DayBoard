import { LICENSE_SUPPORT_EMAIL } from "./license.js";

/** Where Help → Send Feedback and Settings → Updates send testers. */
export const FEEDBACK_EMAIL = LICENSE_SUPPORT_EMAIL;

export interface FeedbackContext {
  appVersion: string;
  osVersion: string;
  arch: string;
}

/** A mailto: link to support with the version details a bug report needs already filled in. */
export function feedbackMailto({ appVersion, osVersion, arch }: FeedbackContext): string {
  const subject = `DayBoard feedback (${appVersion})`;
  const body = [
    "What happened, or what would you like DayBoard to do?",
    "",
    "",
    "",
    "Please leave out passwords, account tokens and private mail.",
    "--",
    `DayBoard ${appVersion}`,
    `macOS ${osVersion} (${arch})`,
  ].join("\r\n");
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
