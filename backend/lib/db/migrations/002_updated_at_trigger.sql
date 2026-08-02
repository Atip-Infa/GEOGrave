-- Migration 002: auto-maintain reports.updated_at at the database layer.
--
-- Previously updated_at was only set by the application code inside
-- reports-repo.js's update() function. That's fine as long as every write
-- path goes through that one function, but it's a silent trap: any future
-- code path that writes to `reports` directly (a new endpoint, a bulk
-- admin script, a fix applied by hand in a SQL console) would leave
-- updated_at stale with no error or warning. A trigger makes it a
-- guarantee of the schema itself rather than a convention every caller
-- has to remember.
--
-- `WHEN` guard: without it, this trigger would fire on every UPDATE
-- including ones that only touch updated_at itself. SQLite's default
-- `recursive_triggers = OFF` already prevents infinite recursion here,
-- but the WHEN clause additionally avoids a redundant no-op write when
-- the caller (reports-repo.js) has already set updated_at in the same
-- statement.
CREATE TRIGGER IF NOT EXISTS reports_touch_updated_at
AFTER UPDATE ON reports
WHEN NEW.updated_at IS OLD.updated_at OR NEW.updated_at IS NULL
BEGIN
  UPDATE reports SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
