/* global fetch, AbortSignal, console */
// Email Routing hands every message for support@getdayboard.com to this Worker. Delivery comes
// first and never depends on the rest: the message is forwarded to the inbox exactly as the old
// "Send to an email" rule did. Then, for mail a person wrote, the feedback scheduled task is
// started once so it can find the email in Gmail, label it and draft a reply. A failure to start it
// is logged and ignored, because throwing after the forward could make Email Routing deliver the
// message twice.

const FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines";
const FIRE_TIMEOUT_MS = 10_000;

export default {
  async email(message, env) {
    if (!env.FORWARD_TO) {
      // Bounce rather than drop: the sender learns it didn't arrive, and nothing is lost silently.
      message.setReject("This address isn't accepting mail right now. Please try again later.");
      console.error("FORWARD_TO is not set; rejected the message");
      return;
    }
    await message.forward(env.FORWARD_TO);
    if (isAutomated(message)) return;
    await startFeedbackCheck(env);
  },
};

/** Bounces, auto-replies and mailing lists don't need a reply, so they don't start the task. */
export function isAutomated(message) {
  const header = (name) => (message.headers.get(name) ?? "").trim().toLowerCase();
  const sender = (message.from ?? "").toLowerCase();
  const autoSubmitted = header("auto-submitted");
  return (
    sender === "" ||
    /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/.test(sender) ||
    (autoSubmitted !== "" && autoSubmitted !== "no") ||
    ["bulk", "junk", "list", "auto_reply"].includes(header("precedence")) ||
    header("list-id") !== "" ||
    header("list-unsubscribe") !== "" ||
    header("x-autoreply") !== "" ||
    header("x-autorespond") !== ""
  );
}

// The request carries no text. This task opens a new project thread on each run, and those tasks
// can't be run with added text; the task finds new support mail in Gmail itself.
export async function startFeedbackCheck(env, fetchImpl = fetch) {
  if (!env.FEEDBACK_TASK_ID || !env.FEEDBACK_TASK_TOKEN) {
    console.warn("Feedback task not configured; forwarded only");
    return "not-configured";
  }
  try {
    const response = await fetchImpl(
      `${FIRE_URL}/${encodeURIComponent(env.FEEDBACK_TASK_ID)}/fire`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.FEEDBACK_TASK_TOKEN}`,
          "anthropic-beta": "experimental-cc-routine-2026-04-01",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      console.error(
        `Feedback task did not start: HTTP ${response.status}${await errorDetail(response)}`,
      );
      return "failed";
    }
    console.log("Feedback task started");
    return "started";
  } catch (error) {
    console.error(`Feedback task did not start: ${error?.name ?? "error"}`);
    return "failed";
  }
}

/** The API's error type and message, which name the cause without any token or mail content. */
async function errorDetail(response) {
  try {
    const { error } = await response.json();
    const detail = [error?.type, error?.message].filter(Boolean).join(": ");
    return detail ? ` (${detail.replace(/[\r\n]+/g, " ").slice(0, 200)})` : "";
  } catch {
    return "";
  }
}
