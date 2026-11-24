# DayBoard Product Hunt launch plan

Launch DayBoard on Product Hunt once Google has approved the Calendar and Tasks scopes and a clean-Mac dry run passes. Nothing is scheduled. Scheduling, posting and every launch-day email or post need Miles's OK at the time.

Rewritten 2026-11-23. The first version (2026-09-23) predated notarized releases, pricing, the Sunbeam icon and the Gmail change, and several of its Product Hunt rules had gone stale.

## Where things stand

| Gate                      | State on 2026-11-23                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Signed, notarized build   | Done. Releases are Developer ID signed and notarized, and the site's installer checks both.                                                                                    |
| Purchase path             | Done. DayBoard Pro is a one-time license through Stripe, for up to 3 Macs, with a 14-day refund. Only the AI features are paid.                                                |
| Free trial                | Done. Every new user gets AI free for 14 days with no card. The clock starts on first AI use, not on install (`shared/license.ts`).                                            |
| Website and privacy page  | Done. `https://getdayboard.com`, with the privacy policy at `/privacy.html`.                                                                                                   |
| Gmail                     | Done without a restricted scope. Mail uses IMAP and SMTP with an app password, so Google reviews only Calendar and Tasks. See `docs/launch/google-verification.md`.            |
| Google OAuth verification | Open. Scope review was submitted on 2026-11-23. Until it is approved, new users see "Google hasn't verified this app" and the project is limited to 100 users in its lifetime. |
| Fresh screenshots         | Open. The sidebar and Settings changed in 1.3.13, so gallery captures must be retaken on a Mac with `npm run screenshots`.                                                     |
| Clean-Mac dry run         | Open. Download, open, Google sign-in, first AI use (trial starts), purchase, activation. Run it within a week of the launch date.                                              |

Google verification is the hard gate. A launch that sends a few hundred strangers into an unverified-app warning, with a 100-user cap, wastes a day that cannot easily be repeated.

## Product Hunt rules

Read from Product Hunt's help pages on 2026-11-23. Recheck them when scheduling.

| Rule                                                                                         | What it means for DayBoard                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A launch runs 12:01 AM to midnight Pacific and can be scheduled up to 30 days ahead          | Schedule once Google approves. The maker comment goes up at 12:01 AM.    |
| Makers can launch their own product                                                          | No hunter needed.                                                        |
| Being featured is an editorial decision; an unfeatured launch still goes live                | The homepage cannot be guaranteed.                                       |
| Never ask for upvotes, never pay for them, no extra accounts, no giveaways tied to votes     | Emails and posts say "we're live, I'd love your feedback" with the link. |
| Name up to 40 characters, tagline up to 60, description up to 500, first comment up to 5,000 | The copy below fits.                                                     |
| Logo 240 by 240; at least one gallery image, 1270 by 760 recommended; video optional         | Sunbeam icon from `brand/`, plus 5 to 6 gallery images.                  |
| Optional promo offer: 25 characters of text and a 15 character code                          | Skip. Checkout has no promo codes.                                       |
| The same URL launched in the last two months needs a relaunch request                        | A weak first launch cannot simply be redone the next week.               |

A different product named Dayboard (dayboard.co, team task management) launched on Product Hunt in 2014. `getdayboard.com` resolves as a new product, so it does not block the launch, but a search for the name shows both.

## Which day

Product Hunt says no weekday guarantees a top spot. Third-party analyses of 2026 launches found weekends need a lower score to rank and have fewer launches, while weekdays bring more visitors. For a first launch without an audience, Saturday gives a better chance at a respectable rank. Avoid the last two weeks of December.

## Listing copy

Drafts. Rewrite them in your own words before submitting.

- **Name:** DayBoard
- **Tagline (58):** Your day on one Mac board, with the AI you already pay for
- **Alternative tagline (51):** Calendar, tasks, reminders and mail on one Mac board
- **Topics:** Productivity, Mac, Task Management (confirm the names in the form)
- **Pricing type:** free with paid options

**Description (recount when pasting, limit 500):**

DayBoard puts Google Calendar, Google Tasks, Apple Reminders and your mail on one board on your Mac. See the day in one agenda, capture a task from the menu bar, and link a task that lives in both Google and Apple. The optional assistant runs on the Claude or ChatGPT subscription you already have, with no API key, and a local MCP server lets your AI tools read and change your day. Your data stays on your Mac. Free, with AI free for 14 days, then a one-time license. Open source.

**First comment:**

Hi, I'm Miles. I built DayBoard because planning my day meant checking four apps: Google Calendar, Google Tasks, Apple Reminders and email. DayBoard puts them on one board on the Mac and keeps every change in sync with Google and Apple.

Two things are different from the planners I tried. Your data stays on your Mac, with no DayBoard server in the middle. And the assistant uses the Claude or ChatGPT subscription you already pay for, so there's no second AI bill.

Everything except AI is free. AI is free for 14 days from the first time you use it, then a one-time license on up to 3 Macs.

It's Mac only for now and there's no iPhone app. What I'd most like to know: what's the one thing in your daily setup this doesn't cover?

## Assets

| Asset   | Spec                         | State                                                                                                                                                                              |
| ------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo    | 240 by 240                   | Export from `brand/dayboard-icon-square.svg`.                                                                                                                                      |
| Gallery | 5 to 6 images at 1270 by 760 | To make, from fresh screenshots: the board, four sources into one agenda, menu bar and Quick Capture, the assistant on your own subscription, the MCP server, privacy and pricing. |
| Video   | Optional                     | Skip for the first launch unless the Google review demo is recut without the consent flow.                                                                                         |

## Launch day

1. 12:01 AM Pacific: the launch goes live. Post the first comment.
2. Morning: one plain email to the list, one post on your own accounts, and a "Live on Product Hunt" strip on the site.
3. All day: reply to every comment.
4. Watch downloads, installs, trials started and purchases with `npm --prefix billing run kpis -- --json`.

## Measuring it

- **Primary:** installs in launch week, and how many of them start the AI trial. The anonymous usage check-in records the license state per install per day, so a launch cohort can be followed from trial to paid.
- **Secondary:** purchases, site visits, reviews and comments on the listing, GitHub stars. Rank is a vanity number.
- GitHub's download count is not a reliable step in this funnel. It counts every fetch of the disk image, including the installer script, release checks and bots.

## Risks

| Risk                                  | Mitigation                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Google sign-in warned or capped       | Verification is the hard gate. Do not schedule before approval.                       |
| "Another Electron app" criticism      | Measure launch time and memory on the release build and answer with numbers.          |
| Confusion about paid plus open source | Plain answer: the source is free under GPL-3.0; the license pays for the AI features. |
| Launch-day bugs                       | No feature releases in the week before. Keep a patch release path ready.              |
| Low revenue disappoints               | At a one-time price, expect installs, feedback and reviews from the day, not income.  |

## Sources

- Product Hunt's help pages (launch timing, scheduling, featuring, voting rules, field limits, relaunch), read 2026-11-23.
- Google verification state and requirements: `docs/launch/google-verification.md`.
