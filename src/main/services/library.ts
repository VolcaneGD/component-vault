import { randomUUID } from 'node:crypto';
import type {
  ComponentRecord,
  ComponentSaveInput,
  LibraryRecord,
  LibrarySaveInput,
  PreviewPolicy,
} from '../../shared/contracts';
import type { DatabaseContext } from '../database/database';

export interface LibraryService {
  listLibraries: () => LibraryRecord[];
  saveLibrary: (library: LibrarySaveInput) => LibraryRecord;
  deleteLibrary: (libraryId: string) => boolean;
  listComponents: (libraryId: string) => ComponentRecord[];
  getComponent: (componentId: string) => ComponentRecord | undefined;
  saveComponent: (component: ComponentSaveInput) => ComponentRecord;
  deleteComponent: (componentId: string) => boolean;
  reorderComponents: (libraryId: string, componentIds: string[]) => void;
  searchComponents: (libraryId: string, query: string) => ComponentRecord[];
}

type LibraryRow = {
  id: string; name: string; description: string; created_at: string; updated_at: string;
};
type ComponentRow = {
  id: string; library_id: string; name: string; description: string; category: string;
  html: string; css: string; javascript: string; source_type: string; original_file_name: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
};
type PolicyRow = {
  allow_scripts: number; allow_forms: number; allow_popups: number;
  external_network_enabled: number; allowed_origins: string;
};

export const createLibraryService = ({ db }: DatabaseContext): LibraryService => {
  const listLibraries = (): LibraryRecord[] => db.prepare(
    'SELECT * FROM libraries ORDER BY created_at ASC, id ASC',
  ).all().map(toLibrary);

  const saveLibrary = (library: LibrarySaveInput): LibraryRecord => {
    const now = new Date().toISOString();
    const id = library.id ?? randomUUID();
    const existing = db.prepare('SELECT id FROM libraries WHERE id = ?').get(id);
    if (existing) {
      db.prepare('UPDATE libraries SET name = ?, description = ?, updated_at = ? WHERE id = ?')
        .run(library.name, library.description, now, id);
    } else {
      db.prepare('INSERT INTO libraries (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, library.name, library.description, now, now);
    }
    return toLibrary(db.prepare('SELECT * FROM libraries WHERE id = ?').get(id));
  };

  const deleteLibrary = (libraryId: string): boolean =>
    db.prepare('DELETE FROM libraries WHERE id = ?').run(libraryId).changes > 0;

  const getComponent = (componentId: string): ComponentRecord | undefined => {
    const row = db.prepare(
      'SELECT * FROM components WHERE id = ? AND deleted_at IS NULL',
    ).get(componentId) as ComponentRow | undefined;
    return row ? readComponent(db, row) : undefined;
  };

  const listComponents = (libraryId: string): ComponentRecord[] => db.prepare(
    'SELECT * FROM components WHERE library_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC, id ASC',
  ).all(libraryId).map(row => readComponent(db, row as ComponentRow));

  const saveComponent = db.transaction((component: ComponentSaveInput): ComponentRecord => {
    const now = new Date().toISOString();
    const id = component.id ?? randomUUID();
    const existing = db.prepare('SELECT id FROM components WHERE id = ?').get(id);
    if (existing) {
      db.prepare(`UPDATE components SET library_id = ?, name = ?, description = ?, category = ?, html = ?, css = ?, javascript = ?, source_type = ?, original_file_name = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`)
        .run(component.libraryId, component.name, component.description, component.category, component.html,
          component.css, component.javascript, component.sourceType, component.originalFileName, now, id);
    } else {
      const nextOrder = (db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM components WHERE library_id = ?',
      ).get(component.libraryId) as { next_order: number }).next_order;
      db.prepare(`INSERT INTO components (id, library_id, name, description, category, html, css, javascript, source_type, original_file_name, sort_order, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
        .run(id, component.libraryId, component.name, component.description, component.category, component.html,
          component.css, component.javascript, component.sourceType, component.originalFileName, nextOrder, now, now);
    }

    db.prepare('DELETE FROM component_tags WHERE component_id = ?').run(id);
    const tagIds = new Map<string, string>();
    for (const [position, rawTag] of component.tags.entries()) {
      const name = rawTag.trim();
      if (!name || tagIds.has(name)) continue;
      const existingTag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: string } | undefined;
      const tagId = existingTag?.id ?? randomUUID();
      if (!existingTag) db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(tagId, name);
      tagIds.set(name, tagId);
      db.prepare('INSERT INTO component_tags (component_id, tag_id, position) VALUES (?, ?, ?)')
        .run(id, tagId, position);
    }

    const policy = component.previewPolicy;
    db.prepare(`INSERT INTO preview_policies (component_id, allow_scripts, allow_forms, allow_popups, external_network_enabled, allowed_origins) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(component_id) DO UPDATE SET allow_scripts = excluded.allow_scripts, allow_forms = excluded.allow_forms, allow_popups = excluded.allow_popups, external_network_enabled = excluded.external_network_enabled, allowed_origins = excluded.allowed_origins`)
      .run(id, asInteger(policy.allowScripts), asInteger(policy.allowForms), asInteger(policy.allowPopups),
        asInteger(policy.externalNetworkEnabled ?? false), JSON.stringify(policy.allowedOrigins));

    return readComponent(db, db.prepare('SELECT * FROM components WHERE id = ?').get(id) as ComponentRow);
  });

  const deleteComponent = (componentId: string): boolean =>
    db.prepare('DELETE FROM components WHERE id = ?').run(componentId).changes > 0;

  const reorderComponents = db.transaction((libraryId: string, componentIds: string[]): void => {
    const actualIds = db.prepare(
      'SELECT id FROM components WHERE library_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at, id',
    ).all(libraryId).map(row => (row as { id: string }).id);
    if (new Set(componentIds).size !== componentIds.length ||
      componentIds.length !== actualIds.length ||
      componentIds.some(id => !actualIds.includes(id))) {
      throw new Error('Component order must contain every component in the library exactly once');
    }
    const update = db.prepare('UPDATE components SET sort_order = ? WHERE id = ? AND library_id = ?');
    componentIds.forEach((id, index) => update.run(index, id, libraryId));
  });

  const searchComponents = (libraryId: string, query: string): ComponentRecord[] => {
    const term = `%${escapeLike(query.trim().toLowerCase())}%`;
    return db.prepare(`SELECT DISTINCT components.* FROM components
      LEFT JOIN component_tags ON component_tags.component_id = components.id
      LEFT JOIN tags ON tags.id = component_tags.tag_id
      WHERE components.library_id = ? AND components.deleted_at IS NULL
        AND (LOWER(components.name) LIKE ? ESCAPE '\\' OR LOWER(components.description) LIKE ? ESCAPE '\\' OR LOWER(tags.name) LIKE ? ESCAPE '\\')
      ORDER BY components.sort_order ASC, components.created_at ASC, components.id ASC`)
      .all(libraryId, term, term, term)
      .map(row => readComponent(db, row as ComponentRow));
  };

  return { listLibraries, saveLibrary, deleteLibrary, listComponents, getComponent, saveComponent, deleteComponent, reorderComponents, searchComponents };
};

const toLibrary = (row: unknown): LibraryRecord => {
  const library = row as LibraryRow;
  return { id: library.id, name: library.name, description: library.description, createdAt: library.created_at, updatedAt: library.updated_at };
};

const readComponent = (db: DatabaseContext['db'], row: ComponentRow): ComponentRecord => {
  const tags = db.prepare(`SELECT tags.name FROM tags JOIN component_tags ON component_tags.tag_id = tags.id WHERE component_tags.component_id = ? ORDER BY component_tags.position ASC`)
    .all(row.id).map(tag => (tag as { name: string }).name);
  const policy = db.prepare('SELECT * FROM preview_policies WHERE component_id = ?').get(row.id) as PolicyRow | undefined;
  return {
    id: row.id, libraryId: row.library_id, name: row.name, description: row.description, category: row.category,
    html: row.html, css: row.css, javascript: row.javascript, sourceType: row.source_type,
    originalFileName: row.original_file_name, createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at, tags,
    previewPolicy: policy ? toPreviewPolicy(policy) : defaultPreviewPolicy(),
  };
};

const toPreviewPolicy = (policy: PolicyRow): PreviewPolicy => ({
  allowScripts: Boolean(policy.allow_scripts), allowForms: Boolean(policy.allow_forms),
  allowPopups: Boolean(policy.allow_popups), externalNetworkEnabled: Boolean(policy.external_network_enabled),
  allowedOrigins: JSON.parse(policy.allowed_origins) as string[],
});

const defaultPreviewPolicy = (): PreviewPolicy => ({
  allowScripts: false, allowForms: false, allowPopups: false, externalNetworkEnabled: false, allowedOrigins: [],
});

const asInteger = (value: boolean): number => value ? 1 : 0;
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, character => `\\${character}`);
