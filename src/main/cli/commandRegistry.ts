import { importHtmlFiles } from '../services/importHtml';
import { createStandaloneHtml, saveStandaloneHtmlAtomically } from '../services/exportHtml';
import type { LibraryService } from '../services/library';
import type { SettingsService } from '../services/settings';
import {
  type AppSettings,
  type ComponentSaveInput,
  type ExportPayload,
  type HtmlImportOptions,
  type LibrarySaveInput,
  type SoftDeleteToken,
} from '../../shared/contracts';
import { isAppSettings } from '../../shared/validation';
import {
  CliNotFoundError,
  CliUsageError,
  type CliCommandDefinition,
  type JsonSchema,
  type JsonValue,
  isRecord,
} from '../../shared/cliProtocol';

export interface CommandRegistryDependencies {
  libraries: LibraryService;
  settings: SettingsService;
  importHtmlFiles?: (paths: string[], options?: HtmlImportOptions) => ReturnType<typeof importHtmlFiles>;
  createStandaloneHtml?: (payload: ExportPayload) => Promise<string>;
  saveStandaloneHtmlAtomically?: typeof saveStandaloneHtmlAtomically;
}

const emptyObject: JsonSchema = { type: 'object', additionalProperties: false };
const idSchema: JsonSchema = { type: 'string', description: 'Component Vault UUID.' };
const revisionSchema: JsonSchema = { type: 'integer', description: 'Revision returned by the latest read.' };
const librarySchema: JsonSchema = { type: 'object', required: ['name'], properties: {
  id: idSchema, name: { type: 'string' }, description: { type: 'string' },
} };
const componentSchema: JsonSchema = { type: 'object', required: [
  'libraryId', 'name', 'description', 'category', 'html', 'css', 'javascript',
  'sourceType', 'originalFileName', 'tags', 'previewPolicy',
], properties: {
  id: idSchema, libraryId: idSchema, name: { type: 'string' }, description: { type: 'string' },
  category: { type: 'string' }, html: { type: 'string' }, css: { type: 'string' },
  javascript: { type: 'string' }, sourceType: { type: 'string' }, originalFileName: { type: 'string' },
  tags: { type: 'array', items: { type: 'string' } }, previewPolicy: { type: 'object' },
} };
const anySchema: JsonSchema = { type: 'object', description: 'JSON object returned by Component Vault.' };

export const commandRegistry = (dependencies: CommandRegistryDependencies): CliCommandDefinition[] => {
  const imports = dependencies.importHtmlFiles ?? importHtmlFiles;
  const buildStandalone = dependencies.createStandaloneHtml ?? createStandaloneHtml;
  const saveStandalone = dependencies.saveStandaloneHtmlAtomically ?? saveStandaloneHtmlAtomically;
  const { libraries, settings } = dependencies;

  const commands: CliCommandDefinition[] = [
    definition('library list', 'List libraries.', false, 'none', emptyObject, () => libraries.listLibraries()),
    definition('library get', 'Read one library by ID.', false, 'none', objectSchema({ id: idSchema }, ['id']), input => {
      const library = libraries.listLibraries().find(item => item.id === requiredId(input, 'id'));
      if (!library) throw new CliNotFoundError('Library was not found.');
      return library;
    }),
    definition('library create', 'Create a library.', true, 'none', objectSchema({ library: librarySchema }, ['library']), input =>
      libraries.saveLibrary(asLibrary(input.library))),
    definition('library update', 'Update a library using its current revision.', true, 'library',
      objectSchema({ library: librarySchema, ifRevision: revisionSchema }, ['library', 'ifRevision']), input =>
        libraries.saveLibraryIfRevision(asExistingLibrary(input.library), requiredRevision(input))),
    definition('library delete', 'Delete a library and its components using its current revision.', true, 'library',
      objectSchema({ id: idSchema, ifRevision: revisionSchema }, ['id', 'ifRevision']), input => {
        if (!libraries.deleteLibraryIfRevision(requiredId(input, 'id'), requiredRevision(input))) {
          throw new CliNotFoundError('Library was not found.');
        }
        return { deleted: true };
      }),
    definition('component list', 'List active components in a library.', false, 'none',
      objectSchema({ libraryId: idSchema }, ['libraryId']), input => libraries.listComponents(requiredId(input, 'libraryId'))),
    definition('component get', 'Read one active component by ID.', false, 'none', objectSchema({ id: idSchema }, ['id']), input => {
      const component = libraries.getComponent(requiredId(input, 'id'));
      if (!component) throw new CliNotFoundError('Component was not found.');
      return component;
    }),
    definition('component search', 'Search component name, description, and tags.', false, 'none',
      objectSchema({ libraryId: idSchema, query: { type: 'string' } }, ['libraryId', 'query']), input =>
        libraries.searchComponents(requiredId(input, 'libraryId'), requiredString(input, 'query', 500))),
    definition('component create', 'Create a component.', true, 'none',
      objectSchema({ component: componentSchema }, ['component']), input => libraries.saveComponent(asComponent(input.component))),
    definition('component update', 'Update a component using its current revision.', true, 'component',
      objectSchema({ component: componentSchema, ifRevision: revisionSchema }, ['component', 'ifRevision']), input =>
        libraries.saveComponentIfRevision(asExistingComponent(input.component), requiredRevision(input))),
    definition('component delete', 'Soft-delete a component using its current revision.', true, 'component',
      objectSchema({ id: idSchema, ifRevision: revisionSchema }, ['id', 'ifRevision']), input => {
        const token = libraries.deleteComponentIfRevision(requiredId(input, 'id'), requiredRevision(input));
        if (!token) throw new CliNotFoundError('Component was not found.');
        return token;
      }),
    definition('component restore', 'Restore a soft-deleted component with its exact undo token.', true, 'none',
      objectSchema({ token: { type: 'object' } }, ['token']), input => {
        const component = libraries.restoreDeletedComponent(asDeleteToken(input.token));
        if (!component) throw new CliNotFoundError('Deleted component was not found or the token expired.');
        return component;
      }),
    definition('component finalize-delete', 'Permanently remove an expired soft-deleted component.', true, 'none',
      objectSchema({ token: { type: 'object' } }, ['token']), input => ({
        deleted: libraries.finalizeDeletedComponent(asDeleteToken(input.token)),
      })),
    definition('component reorder', 'Set a library component order using the library revision.', true, 'library',
      objectSchema({ libraryId: idSchema, componentIds: { type: 'array', items: idSchema }, ifRevision: revisionSchema },
        ['libraryId', 'componentIds', 'ifRevision']), input => {
        const componentIds = requiredArray(input, 'componentIds').map((item, index) => requiredIdValue(item, `componentIds[${index}]`));
        libraries.reorderComponentsIfRevision(requiredId(input, 'libraryId'), componentIds, requiredRevision(input));
        return { reordered: true };
      }),
    definition('import', 'Parse HTML or Component Vault export files into import candidates.', false, 'none',
      objectSchema({ paths: { type: 'array', items: { type: 'string' } }, options: { type: 'object' } }, ['paths']), input =>
        imports(requiredArray(input, 'paths').map((value, index) => requiredStringValue(value, `paths[${index}]`, 32_767)), asImportOptions(input.options))),
    definition('export', 'Write a standalone Component Vault HTML export to a supplied path.', false, 'none',
      objectSchema({ payload: { type: 'object' }, path: { type: 'string' } }, ['payload', 'path']), async input => {
        const path = requiredString(input, 'path', 32_767);
        const html = await buildStandalone(asExportPayload(input.payload));
        const saved = await saveStandalone(path, html);
        if (!saved.ok) throw new CliUsageError(`Export failed: ${saved.message}`);
        return { path: saved.path };
      }),
    definition('settings get', 'Read application settings.', false, 'none', emptyObject, () => settings.getAppSettings()),
    definition('settings set', 'Update application settings.', true, 'none',
      objectSchema({ patch: { type: 'object' } }, ['patch']), input => settings.saveAppSettings(asSettingsPatch(input.patch))),
  ];
  return commands;
};

const definition = (
  name: string, summary: string, mutates: boolean, revision: CliCommandDefinition['revision'],
  inputSchema: JsonSchema, execute: CliCommandDefinition['execute'],
): CliCommandDefinition => ({ name, summary, mutates, revision, inputSchema, outputSchema: anySchema, execute });

const objectSchema = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({
  type: 'object', properties, required, additionalProperties: false,
});

const requiredRecord = (value: JsonValue | undefined, name: string): Record<string, JsonValue> => {
  if (!isRecord(value)) throw new CliUsageError(`${name} must be an object.`);
  return value;
};

const requiredStringValue = (value: JsonValue | undefined, name: string, limit: number): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) {
    throw new CliUsageError(`${name} must be a non-empty string no longer than ${limit} characters.`);
  }
  return value;
};

const requiredString = (input: Record<string, JsonValue>, name: string, limit: number): string =>
  requiredStringValue(input[name], name, limit);

const requiredIdValue = (value: JsonValue | undefined, name: string): string => {
  const id = requiredStringValue(value, name, 100);
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new CliUsageError(`${name} is invalid.`);
  return id;
};

const requiredId = (input: Record<string, JsonValue>, name: string): string => requiredIdValue(input[name], name);

const requiredRevision = (input: Record<string, JsonValue>): number => {
  const revision = input.ifRevision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
    throw new CliUsageError('ifRevision must be a positive integer returned by the latest read.');
  }
  return revision;
};

const requiredArray = (input: Record<string, JsonValue>, name: string): JsonValue[] => {
  const value = input[name];
  if (!Array.isArray(value)) throw new CliUsageError(`${name} must be an array.`);
  return value;
};

const optionalString = (value: JsonValue | undefined, name: string, limit: number): string => {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit) throw new CliUsageError(`${name} must be a string no longer than ${limit} characters.`);
  return value;
};

const asLibrary = (value: JsonValue | undefined): LibrarySaveInput => {
  const input = requiredRecord(value, 'library');
  return {
    ...(input.id === undefined ? {} : { id: requiredId(input, 'id') }),
    name: requiredString(input, 'name', 255), description: optionalString(input.description, 'library.description', 10_000),
  };
};

const asExistingLibrary = (value: JsonValue | undefined): LibrarySaveInput => {
  const library = asLibrary(value);
  if (!library.id) throw new CliUsageError('library.id is required for an update.');
  return library;
};

const asComponent = (value: JsonValue | undefined): ComponentSaveInput => {
  const input = requiredRecord(value, 'component');
  const tags = requiredArray(input, 'tags').map((tag, index) => requiredStringValue(tag, `component.tags[${index}]`, 100));
  if (input.originalFileName !== null && input.originalFileName !== undefined && typeof input.originalFileName !== 'string') {
    throw new CliUsageError('component.originalFileName must be a string or null.');
  }
  const previewPolicy = requiredRecord(input.previewPolicy, 'component.previewPolicy');
  return {
    ...(input.id === undefined ? {} : { id: requiredId(input, 'id') }),
    libraryId: requiredId(input, 'libraryId'), name: requiredString(input, 'name', 255),
    description: optionalString(input.description, 'component.description', 10_000),
    category: optionalString(input.category, 'component.category', 255),
    html: optionalString(input.html, 'component.html', 2_000_000),
    css: optionalString(input.css, 'component.css', 2_000_000),
    javascript: optionalString(input.javascript, 'component.javascript', 2_000_000),
    sourceType: requiredString(input, 'sourceType', 64),
    originalFileName: input.originalFileName === undefined ? null : input.originalFileName as string | null,
    tags,
    previewPolicy: {
      allowScripts: requiredBoolean(previewPolicy, 'allowScripts'),
      allowForms: requiredBoolean(previewPolicy, 'allowForms'),
      allowPopups: requiredBoolean(previewPolicy, 'allowPopups'),
      ...(previewPolicy.externalNetworkEnabled === undefined ? {} : { externalNetworkEnabled: requiredBoolean(previewPolicy, 'externalNetworkEnabled') }),
      allowedOrigins: requiredArray(previewPolicy, 'allowedOrigins').map((origin, index) => requiredStringValue(origin, `component.previewPolicy.allowedOrigins[${index}]`, 500)),
    },
  };
};

const asExistingComponent = (value: JsonValue | undefined): ComponentSaveInput => {
  const component = asComponent(value);
  if (!component.id) throw new CliUsageError('component.id is required for an update.');
  return component;
};

const requiredBoolean = (input: Record<string, JsonValue>, name: string): boolean => {
  if (typeof input[name] !== 'boolean') throw new CliUsageError(`${name} must be a boolean.`);
  return input[name];
};

const asDeleteToken = (value: JsonValue | undefined): SoftDeleteToken => {
  const input = requiredRecord(value, 'token');
  return {
    componentId: requiredId(input, 'componentId'),
    deletedAt: requiredString(input, 'deletedAt', 64),
    expiresAt: requiredString(input, 'expiresAt', 64),
  };
};

const asImportOptions = (value: JsonValue | undefined): HtmlImportOptions => {
  if (value === undefined) return {};
  const input = requiredRecord(value, 'options');
  if (input.allowLargeFiles !== undefined && typeof input.allowLargeFiles !== 'boolean') {
    throw new CliUsageError('options.allowLargeFiles must be a boolean.');
  }
  return input.allowLargeFiles === undefined ? {} : { allowLargeFiles: input.allowLargeFiles };
};

const asExportPayload = (value: JsonValue | undefined): ExportPayload => {
  const payload = requiredRecord(value, 'payload') as unknown as ExportPayload;
  if (payload.format !== 'component-vault' || payload.version !== 1) {
    throw new CliUsageError('payload must be a Component Vault version 1 export.');
  }
  return payload;
};

const asSettingsPatch = (value: JsonValue | undefined): Partial<AppSettings> => {
  const patch = requiredRecord(value, 'patch') as unknown as Partial<AppSettings>;
  const allowed = new Set(['language', 'viewMode', 'galleryColumns', 'editorPreviewRatio', 'studioPaneRatios', 'lastLibraryId', 'lastComponentId']);
  if (Object.keys(patch).some(key => !allowed.has(key))) throw new CliUsageError('Unknown application setting.');
  if (!isAppSettings({
    language: patch.language ?? 'en', viewMode: patch.viewMode ?? 'workbench', galleryColumns: patch.galleryColumns ?? 3,
    editorPreviewRatio: patch.editorPreviewRatio ?? 0.55, studioPaneRatios: patch.studioPaneRatios ?? [0.24, 0.42, 0.34],
    lastLibraryId: patch.lastLibraryId ?? null, lastComponentId: patch.lastComponentId ?? null,
  })) throw new CliUsageError('Invalid application settings.');
  return patch;
};
