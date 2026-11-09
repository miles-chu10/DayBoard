import { FEEDBACK_EMAIL } from "@shared/feedback";
import { toast } from "../ui";
import { errorMessage, invoke } from "./ipc";

/** Opens a new email to support in the mail app, falling back to the address in a toast. */
export function sendFeedback(): Promise<void> {
  return invoke("app:sendFeedback").then(
    () => undefined,
    (error: unknown) => {
      toast.error("Couldn’t open your mail app", {
        description: `${errorMessage(error)} Email ${FEEDBACK_EMAIL} instead.`,
      });
    },
  );
}

export function copyFeedbackAddress(): Promise<void> {
  return invoke("app:copyFeedbackAddress").then(
    () => {
      toast.success(`Copied ${FEEDBACK_EMAIL}`);
    },
    (error: unknown) => {
      toast.error(`Couldn’t copy the address: ${errorMessage(error)}`);
    },
  );
}
