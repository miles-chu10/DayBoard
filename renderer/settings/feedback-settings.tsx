import { useQuery } from "@tanstack/react-query";
import { FEEDBACK_EMAIL, feedbackOpensIn } from "@shared/feedback";
import { Button, Field, FieldSet } from "../ui";
import { copyFeedbackAddress, sendFeedback } from "../lib/feedback";
import { invoke } from "../lib/ipc";

export function FeedbackSettings() {
  // Refetched on focus, so it's right after the default mail app is changed in another app.
  const mailApp = useQuery({
    queryKey: ["feedback-mail-app"],
    queryFn: () => invoke<string>("app:feedbackMailApp"),
    refetchOnWindowFocus: "always",
  });
  const opensIn = feedbackOpensIn(mailApp.data ?? "");
  return (
    <FieldSet
      title="Feedback"
      description="Found a bug or have an idea? Send feedback opens a new email in your mail app with your DayBoard and macOS versions filled in. If you use mail in a browser, copy the address instead."
    >
      <Field label="Email" description={opensIn ? `${FEEDBACK_EMAIL}. ${opensIn}` : FEEDBACK_EMAIL}>
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
