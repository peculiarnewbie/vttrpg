PRAGMA foreign_keys = ON;

CREATE TABLE systems (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL,
  metadata TEXT NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(id),
  owner_account_id TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  latest_version INTEGER,
  metadata TEXT NOT NULL
);

CREATE TABLE versions (
  source_id TEXT NOT NULL REFERENCES sources(id),
  version INTEGER NOT NULL CHECK (version > 0),
  manifest TEXT NOT NULL,
  PRIMARY KEY (source_id, version)
);

CREATE INDEX sources_owner ON sources(owner_account_id);
