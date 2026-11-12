import { AlertDialog } from "@renderer/ui";
import type { AIProvider } from "@main/shared-types";

import { PROVIDER_LABEL } from "../lib/settings";

/**
 * Asked before AI turns on. Google's user data policy requires the user's consent before Google
 * data is sent to an AI provider, so every way of turning AI on goes through this dialog.
 */
export function AIConsentDialog({
  open,
  onOpenChange,
  provider,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: AIProvider;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      size="medium"
      title="Turn on AI features?"
      description="AI features send some of your data to the AI provider you choose."
      confirmLabel="Turn On AI"
      onConfirm={() => {
        onOpenChange(false);
        onConfirm();
      }}
    >
      <div className="flex flex-col gap-2 text-regular text-secondary" data-testid="ai-disclosure">
        <p>
          When you use an AI feature, DayBoard sends the tasks, email, calendar events and notes
          that feature needs to {PROVIDER_LABEL[provider]}, using your own account or API key.
          Assistant messages go to the provider you pick in the composer.
        </p>
        <p>
          This can include data from your Google account. It goes straight from this Mac to the
          provider and never passes through a DayBoard server. DayBoard doesn’t use it to train AI
          models. The provider’s own terms and privacy policy apply.
        </p>
        <p>Nothing is sent while AI is off, and you can turn it off at any time in Settings.</p>
      </div>
    </AlertDialog>
  );
}
