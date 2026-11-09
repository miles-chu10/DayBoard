-- Anonymous daily check-ins from DayBoard release builds, so the owner can count Macs in use,
-- AI trials and Pro licenses. Additive only: one table, one index and three read-only views.
--
-- One row per install and UTC day. install_id is a random ID the app made for this purpose: not the
-- license installation ID and not derived from hardware, so it can't be joined to activations.
-- No IP address, email address, license key or account data is stored. Each new check-in deletes
-- rows older than 400 days. first_day carries an install's first check-in forward from row to
-- row, so new installs stay countable after older rows are deleted. A reinstall that wipes app data,
-- or a second macOS account, makes a new install ID and counts as a new install.
CREATE TABLE usage_checkins (
  install_id TEXT NOT NULL CHECK (length(install_id) = 36),
  day TEXT NOT NULL CHECK (length(day) = 10 AND day = date(day)),
  first_day TEXT NOT NULL CHECK (length(first_day) = 10 AND first_day = date(first_day) AND first_day <= day),
  app_version TEXT NOT NULL CHECK (length(app_version) BETWEEN 5 AND 32),
  license_state TEXT NOT NULL CHECK (
    license_state IN ('trial', 'expired', 'licensed', 'invalid', 'network-error', 'unreadable')
  ),
  PRIMARY KEY (install_id, day)
) WITHOUT ROWID;
CREATE INDEX usage_checkins_day ON usage_checkins (day);

-- Per UTC day, newest first: installs that checked in, how many of them were new, and their license
-- states. trial counts installs inside the trial, including ones that haven't used AI yet.
CREATE VIEW usage_daily AS
SELECT day,
  COUNT(*) AS active_installs,
  SUM(first_day = day) AS new_installs,
  SUM(license_state = 'trial') AS trial,
  SUM(license_state = 'expired') AS trial_ended,
  SUM(license_state = 'licensed') AS pro,
  SUM(license_state IN ('invalid', 'network-error', 'unreadable')) AS license_problem
FROM usage_checkins
GROUP BY day
ORDER BY day DESC;

-- Rolling counts as of now (UTC): distinct installs seen today, in the last 7 and 30 days, and
-- since the oldest kept row, plus new installs and Pro installs in the last 30 days.
CREATE VIEW usage_summary AS
SELECT
  COUNT(DISTINCT CASE WHEN day = date('now') THEN install_id END) AS active_today,
  COUNT(DISTINCT CASE WHEN day >= date('now', '-6 days') THEN install_id END) AS active_7_days,
  COUNT(DISTINCT CASE WHEN day >= date('now', '-29 days') THEN install_id END) AS active_30_days,
  COUNT(DISTINCT CASE WHEN first_day >= date('now', '-29 days') THEN install_id END) AS new_30_days,
  COUNT(DISTINCT CASE WHEN day >= date('now', '-29 days') AND license_state = 'licensed'
    THEN install_id END) AS pro_30_days,
  COUNT(DISTINCT install_id) AS installs_seen
FROM usage_checkins;

-- Which versions installs ran in the last 7 days, to see how fast updates spread.
CREATE VIEW usage_versions AS
SELECT app_version, COUNT(DISTINCT install_id) AS installs_7_days
FROM usage_checkins
WHERE day >= date('now', '-6 days')
GROUP BY app_version
ORDER BY installs_7_days DESC, app_version DESC;
