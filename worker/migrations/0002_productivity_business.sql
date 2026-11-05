CREATE TABLE IF NOT EXISTS iris_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  source TEXT NOT NULL DEFAULT 'user-approved',
  importance INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS iris_memories_user_idx ON iris_memories(user_id, updated_at);

CREATE TABLE IF NOT EXISTS iris_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  category TEXT NOT NULL DEFAULT 'Geral',
  due_at TEXT,
  recurrence TEXT,
  completed_at TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS iris_tasks_user_idx ON iris_tasks(user_id, updated_at);

CREATE TABLE IF NOT EXISTS iris_business (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'contact',
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS iris_business_user_idx ON iris_business(user_id, updated_at);
