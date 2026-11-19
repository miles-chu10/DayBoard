/* global fetch, AbortSignal, console */
// Email Routing hands every message for support@getdayboard.com to this Worker. Delivery comes
// first and never depends on the rest: the message is forwarded to the inbox exactly as the old
// "Send to an email" rule did. Then, for mail a person wrote, the feedback scheduled task is
// started once so it can label the thread and draft a reply. A failure to start it is logged and
// ignored, because throwing after the forward could make Email Routing deliver the message twice.

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
    await startFeedbackCheck(message, env);
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

/** The task reads the message from Gmail itself; this only says which one to look for. */
export function firePayload(message) {
  const field = (name, max) =>
    (message.headers.get(name) ?? "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, max);
  return [
    "A new email reached support@getdayboard.com.",
    `Message-ID: ${field("message-id", 300) || "(none)"}`,
    `Subject: ${field("subject", 200) || "(none)"}`,
  ].join("\n");
}

export async function startFeedbackCheck(message, env, fetchImpl = fetch) {
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
        body: JSON.stringify({ text: firePayload(message) }),
        signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      console.error(`Feedback task did not start: HTTP ${response.status}`);
      return "failed";
    }
    console.log("Feedback task started");
    return "started";
  } catch (error) {
    console.error(`Feedback task did not start: ${error?.name ?? "error"}`);
    return "failed";
  }
}
