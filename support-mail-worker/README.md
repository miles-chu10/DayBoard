# Support mail Worker

Mail for `support@getdayboard.com` (Send Feedback in the app, and the address on the site) goes
through this Worker instead of a plain Email Routing forward. For each message it:

1. Forwards it to the inbox in `FORWARD_TO`, exactly like the old "Send to an email" rule. This
   always happens first and never depends on step 2.
2. If a person wrote it (not a bounce, auto-reply or mailing list), starts the "DayBoard feedback
   check" scheduled task once over its API, passing only the message's `Message-ID` and subject. The
   task reads the email from Gmail, labels it `Projects/DayBoard/Feedback` and writes a reply draft.
   It never sends mail.

If starting the task fails, the Worker logs `Feedback task did not start: HTTP <status>` and the
email is still delivered. Every run of the task looks at all unlabelled support mail from the last
30 days, so the next email also picks up one that was missed.

## Secrets

Set with `npx --prefix ../billing wrangler secret put <NAME>` from this folder, or in the dashboard
under Workers & Pages → dayboard-support-mail → Settings → Variables and Secrets (type Secret).
None of them belong in `wrangler.jsonc` or the repository.

- `FORWARD_TO`: the inbox address. It must be a verified destination address in Email Routing.
  Without it the Worker rejects mail so the sender gets a bounce instead of silence.
- `FEEDBACK_TASK_ID`: the scheduled task's id (`trig_…`).
- `FEEDBACK_TASK_TOKEN`: the task's API token. Make it at claude.ai/code/routines → the task → Edit
  → Trigger → API → Generate token. It is shown once. Paste it straight into Cloudflare; don't send
  it anywhere else. Regenerate it there to rotate, then update the secret.

Without the two task secrets the Worker forwards only.

## Deploy and switch over

Deploying and changing the routing rule each need Miles's OK.

```sh
# support-mail-worker/
npx --prefix ../billing wrangler deploy --dry-run   # uploads nothing
npx --prefix ../billing wrangler deploy
```

Then in the dashboard: Email → Email Routing → Routing rules → `support@getdayboard.com` → Edit →
Action "Send to a Worker" → `dayboard-support-mail` → Save. Send a test email to the address and
check that it arrives in the inbox and that the Worker's logs show `Feedback task started`.

Rollback: set the rule's action back to "Send to an email" with the inbox address. Mail flows as
before, and the Worker can stay deployed unused.
