CREATE TABLE IF NOT EXISTS iris_device_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_hash TEXT NOT NULL,
  secret_version TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) <= 100),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS iris_device_sessions_user_active_idx
  ON iris_device_sessions(user_id, revoked_at, expires_at);
