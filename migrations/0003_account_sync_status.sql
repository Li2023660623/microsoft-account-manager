ALTER TABLE accounts ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE accounts ADD COLUMN sync_message TEXT;
ALTER TABLE accounts ADD COLUMN refreshed_at TEXT;
ALTER TABLE accounts ADD COLUMN fetched_at TEXT;
ALTER TABLE accounts ADD COLUMN fetched_count INTEGER NOT NULL DEFAULT 0;
