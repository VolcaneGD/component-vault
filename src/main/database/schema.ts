export const SCHEMA_VERSION = 2;

export const schemaV1 = `
  CREATE TABLE IF NOT EXISTS schema_meta (
    version INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS libraries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS components (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    html TEXT NOT NULL,
    css TEXT NOT NULL,
    javascript TEXT NOT NULL,
    source_type TEXT NOT NULL,
    original_file_name TEXT,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS component_tags (
    component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (component_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS preview_policies (
    component_id TEXT PRIMARY KEY REFERENCES components(id) ON DELETE CASCADE,
    allow_scripts INTEGER NOT NULL DEFAULT 0,
    allow_forms INTEGER NOT NULL DEFAULT 0,
    allow_popups INTEGER NOT NULL DEFAULT 0,
    external_network_enabled INTEGER NOT NULL DEFAULT 0,
    allowed_origins TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS components_by_library_order
    ON components(library_id, sort_order, created_at);
  CREATE INDEX IF NOT EXISTS components_by_name ON components(name);
  CREATE INDEX IF NOT EXISTS tags_by_name ON tags(name);
`;

export const schemaV2 = `
  CREATE TABLE IF NOT EXISTS component_deletion_tombstones (
    component_id TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL
  );

  INSERT OR IGNORE INTO component_deletion_tombstones (component_id, deleted_at)
    SELECT id, deleted_at FROM components WHERE deleted_at IS NOT NULL;
`;
