-- Login throttling counters. key is 'user:<username_normalized>' or 'ip:<sha256-base64url>'.
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  locked_until TEXT
);

-- Indexes for the scheduled cleanup job.
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_flows_expires_at ON auth_flows(expires_at);
