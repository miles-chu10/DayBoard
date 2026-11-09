import { FEEDBACK_EMAIL } from "@shared/feedback";
import { Button, Field, FieldSet, toast } from "../ui";
import { errorMessage, invoke } from "../lib/ipc";

export function FeedbackSettings() {
  const sendFeedback = () =>
    invoke("app:sendFeedback").catch((error: unknown) =>
      toast.error("Couldn’t open your mail app", {
        description: `${errorMessage(error)} Email ${FEEDBACK_EMAIL} instead.`,
      }),
    );
  const copyAddress = () =>
    invoke("app:copyFeedbackAddress").then(
      () => toast.success(`Copied ${FEEDBACK_EMAIL}`),
      (error: unknown) => toast.error(`Couldn’t copy the address: ${errorMessage(error)}`),
    );
  return (
    <FieldSet
      title="Feedback"
      description="Found a bug or have an idea? Send feedback opens a new email in your mail app with your DayBoard and macOS versions filled in. If you use mail in a browser, copy the address instead."
    >
      <Field label="Email" description={FEEDBACK_EMAIL}>
        <div className="flex items-center gap-2">
          <Button size="small" onClick={() => void sendFeedback()}>
            Send feedback…
          </Button>
          <Button size="small" variant="transparent" onClick={() => void copyAddress()}>
            Copy address
          </Button>
        </div>
      </Field>
    </FieldSet>
  );
}
