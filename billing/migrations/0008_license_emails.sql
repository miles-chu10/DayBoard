-- Send state for the license key email a buyer gets after paying. Additive only: one table and
-- one index, and no change to an existing table or row.
--
-- One row per paid order whose key is emailed, written when the key is issued and the email is
-- configured. Orders issued while the email is off, and complimentary licenses, have no row.
-- The address is never stored here or anywhere else in this database: each attempt reads it from
-- the order's Stripe Checkout Session.
--
-- state is pending (owed, and the scheduled retry sends it), sent (the provider accepted it),
-- failed (not accepted within 23 hours of queued_at) or skipped (the Session had no usable
-- address, or the order was refunded or disputed first). next_at is the earliest time of the next
-- attempt. Claiming an attempt moves it forward, so parallel deliveries send once. queued_at also
-- names the provider's idempotency key. Retries stop before its 24-hour retention expires.
CREATE TABLE license_emails (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'failed', 'skipped')),
  queued_at INTEGER NOT NULL CHECK (queued_at > 0),
  next_at INTEGER NOT NULL CHECK (next_at >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  sent_at INTEGER
);
CREATE INDEX license_emails_due ON license_emails (next_at) WHERE state = 'pending';
