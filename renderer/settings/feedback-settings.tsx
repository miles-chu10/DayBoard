import { FEEDBACK_EMAIL } from "@shared/feedback";
import { Button, Field, FieldSet } from "../ui";
import { copyFeedbackAddress, sendFeedback } from "../lib/feedback";

export function FeedbackSettings() {
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
          <Button size="small" variant="transparent" onClick={() => void copyFeedbackAddress()}>
            Copy address
          </Button>
        </div>
      </Field>
    </FieldSet>
  );
}
