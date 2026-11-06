-- Audit history must outlive the users it mentions. D1 enforces foreign keys,
-- so the original `actor_user_id REFERENCES users(id)` made every viewer who
-- had ever logged in impossible to hard-delete (DELETE FROM users failed with
-- a FOREIGN KEY constraint error). SQLite cannot drop a constraint in place,
-- so rebuild the table without it. Nothing references audit_events.
CREATE TABLE audit_events_new (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  account_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  outcome TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO audit_events_new (
  id, actor_user_id, account_id, action, target_type, target_id,
  ip_hash, user_agent_hash, outcome, metadata_json, created_at
)
SELECT
  id, actor_user_id, account_id, action, target_type, target_id,
  ip_hash, user_agent_hash, outcome, metadata_json, created_at
FROM audit_events;

DROP TABLE audit_events;
ALTER TABLE audit_events_new RENAME TO audit_events;

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
