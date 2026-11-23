-- The update newsletter: who gets an email when a new DayBoard version is published, and the send
-- state of each of those emails. Additive only: three tables and one index, and no change to an
-- existing table or row.
--
-- update_subscribers holds one row per address. token is the random secret in that address's
-- unsubscribe link, so the link never carries the address. unsubscribed_at is set when the person
-- unsubscribes. The row stays so a later signup from the website can't quietly re-add them.
CREATE TABLE update_subscribers (
  email TEXT PRIMARY KEY CHECK (email = lower(trim(email)) AND length(email) BETWEEN 6 AND 254),
  token TEXT NOT NULL UNIQUE CHECK (length(token) = 32),
  source TEXT NOT NULL CHECK (source IN ('waitlist', 'site')),
  subscribed_at INTEGER NOT NULL CHECK (subscribed_at > 0),
  unsubscribed_at INTEGER
);

-- The first subscribers are the people who joined the waitlist, which promised "major DayBoard
-- news": every signup that isn't a known test address and hasn't asked not to be emailed. No
-- signup row is changed or deleted.
INSERT OR IGNORE INTO update_subscribers (email, token, source, subscribed_at)
SELECT lower(trim(b.email)), lower(hex(randomblob(16))), 'waitlist', b.created_at
FROM beta_signups AS b
WHERE b.classification <> 'likely_test'
  AND NOT EXISTS (SELECT 1 FROM email_suppressions AS s WHERE s.email = lower(trim(b.email)));

-- One row per release email, keyed by the version it announces, so a version is announced once.
CREATE TABLE update_mailings (
  version TEXT PRIMARY KEY CHECK (length(version) BETWEEN 1 AND 32),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at > 0)
);

-- One row per recipient of a release email. state is pending (owed, and the scheduled run sends
-- it), sent (the provider accepted it), failed (not accepted within 23 hours of the mailing) or
-- skipped (the person unsubscribed first). next_at is the earliest time of the next attempt.
-- Claiming an attempt moves it forward, so parallel runs send once.
CREATE TABLE update_deliveries (
  version TEXT NOT NULL REFERENCES update_mailings(version),
  email TEXT NOT NULL REFERENCES update_subscribers(email),
  state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'failed', 'skipped')),
  next_at INTEGER NOT NULL CHECK (next_at >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  sent_at INTEGER,
  PRIMARY KEY (version, email)
);
CREATE INDEX update_deliveries_due ON update_deliveries (next_at) WHERE state = 'pending';
