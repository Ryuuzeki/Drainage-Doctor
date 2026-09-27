CREATE TABLE IF NOT EXISTS analysis_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 owner TEXT NOT NULL,
 project_id TEXT NOT NULL,
 model_hash TEXT NOT NULL,
 status TEXT NOT NULL,
 data TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS analysis_owner_project ON analysis_jobs(owner, project_id, created_at);
