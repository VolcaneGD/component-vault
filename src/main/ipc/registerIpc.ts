import type { IpcMainInvokeEvent } from 'electron';
import {
  isPreviewPolicy,
  isHttpsOrigin,
  type AppSettings,
  type ComponentSaveInput,
  type HtmlImportOptions,
  type ExportPayload,
  type LibrarySaveInput,
  type PreviewNetworkPolicyRequest,
  type RecoverySnapshot,
  type SoftDeleteToken,
} from '../../shared/contracts';
import { isAppSettings } from '../../shared/validation';
import { importHtmlFiles } from '../services/importHtml';
import {
  createStandaloneHtml,
  sanitizeDownloadFileName,
  saveStandaloneHtmlAtomically,
} from '../services/exportHtml';
import type { LibraryService } from '../services/library';
import type { SettingsService } from '../services/settings';
import type { PreviewSecurityController } from '../security/previewSecurity';
import { IPC_CHANNELS } from '../../shared/ipcChannels';

export { IPC_CHANNELS } from '../../shared/ipcChannels';

interface IpcHandlerRegistrar {
  handle: (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;
}

interface RegisterIpcDependencies {
  ipcMain: IpcHandlerRegistrar;
  appVersion: () => string;
  electronVersion: () => string;
  recoverySnapshot: () => RecoverySnapshot | null;
  libraries: LibraryService;
  settings: SettingsService;
  previewSecurity: PreviewSecurityController;
  clipboard: { writeText: (text: string) => void };
  externalLinks: { openExternal: (url: string) => Promise<void> };
  dialogs: {
    showSaveDialog: (options: {
      title: string;
      defaultPath: string;
      filters: Array<{ name: string; extensions: string[] }>;
    }) => Promise<{ canceled: boolean; filePath?: string }>;
  };
}

export const registerIpcHandlers = ({
  ipcMain,
  appVersion,
  electronVersion,
  recoverySnapshot,
  libraries,
  settings,
  previewSecurity,
  clipboard,
  externalLinks,
  dialogs,
}: RegisterIpcDependencies): void => {
  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => appVersion());
  ipcMain.handle(IPC_CHANNELS.appGetElectronVersion, () => electronVersion());
  ipcMain.handle(IPC_CHANNELS.appGetRecoverySnapshot, () => recoverySnapshot());
  ipcMain.handle(IPC_CHANNELS.appOpenExternal, async (event, url) => {
    assertMainFrame(event, 'External links');
    await externalLinks.openExternal(validateExternalUrl(url));
  });
  ipcMain.handle(IPC_CHANNELS.libraryList, () => libraries.listLibraries());
  ipcMain.handle(IPC_CHANNELS.librarySave, (_event, input) => libraries.saveLibrary(validateLibrary(input)));
  ipcMain.handle(IPC_CHANNELS.libraryDelete, (_event, id) => libraries.deleteLibrary(validateId(id, 'library id')));
  ipcMain.handle(IPC_CHANNELS.componentList, (_event, libraryId) => libraries.listComponents(validateId(libraryId, 'library id')));
  ipcMain.handle(IPC_CHANNELS.componentSave, (_event, input) => libraries.saveComponent(validateComponent(input)));
  ipcMain.handle(IPC_CHANNELS.componentDelete, (_event, id) => libraries.deleteComponent(validateId(id, 'component id')));
  ipcMain.handle(IPC_CHANNELS.componentRestore, (event, token) => {
    assertMainFrame(event, 'Component restore');
    return libraries.restoreDeletedComponent(validateSoftDeleteToken(token)) ?? null;
  });
  ipcMain.handle(IPC_CHANNELS.componentFinalizeDelete, (event, token) => {
    assertMainFrame(event, 'Component delete finalization');
    return libraries.finalizeDeletedComponent(validateSoftDeleteToken(token));
  });
  ipcMain.handle(IPC_CHANNELS.componentReorder, (_event, libraryId, componentIds) => {
    const validLibraryId = validateId(libraryId, 'library id');
    if (!Array.isArray(componentIds)) throw new Error('Invalid component ids');
    libraries.reorderComponents(validLibraryId, componentIds.map(id => validateId(id, 'component id')));
  });
  ipcMain.handle(IPC_CHANNELS.componentSearch, (_event, libraryId, query) =>
    libraries.searchComponents(validateId(libraryId, 'library id'), validateString(query, 'query', 500)));
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => settings.getAppSettings());
  ipcMain.handle(IPC_CHANNELS.settingsUpdate, (_event, patch) => settings.saveAppSettings(validateSettingsPatch(patch)));
  ipcMain.handle(IPC_CHANNELS.componentImportHtml, (_event, paths, options) =>
    importHtmlFiles(validateImportPaths(paths), validateImportOptions(options)));
  ipcMain.handle(IPC_CHANNELS.clipboardWriteText, async (event, text) => {
    assertMainFrame(event, 'Clipboard writes');
    clipboard.writeText(validateString(text, 'clipboard text', 8_000_000));
  });
  ipcMain.handle(IPC_CHANNELS.exportSaveStandalone, async (event, payload) => {
    assertMainFrame(event, 'Export');
    const html = await createStandaloneHtml(payload as ExportPayload);
    const exportPayload = payload as ExportPayload;
    const saveDialog = await dialogs.showSaveDialog({
      title: 'Save Component Vault standalone HTML',
      defaultPath: sanitizeDownloadFileName(exportPayload.library.name, '.html'),
      filters: [{ name: 'HTML document', extensions: ['html'] }],
    });
    if (saveDialog.canceled || !saveDialog.filePath) {
      return { ok: false, cancelled: true, message: 'Save cancelled' } as const;
    }
    const result = await saveStandaloneHtmlAtomically(saveDialog.filePath, html);
    return result.ok
      ? { ok: true, path: result.path } as const
      : { ok: false, message: boundedSaveError(result.message) } as const;
  });
  ipcMain.handle(IPC_CHANNELS.exportSaveCss, async (event, suggestedFileName, css) => {
    assertMainFrame(event, 'CSS export');
    const fileName = sanitizeDownloadFileName(
      validateString(suggestedFileName, 'CSS filename', 255, false),
      '.css',
    );
    const content = validateString(css, 'component CSS', 2_000_000);
    const saveDialog = await dialogs.showSaveDialog({
      title: 'Save component CSS',
      defaultPath: fileName,
      filters: [{ name: 'CSS stylesheet', extensions: ['css'] }],
    });
    if (saveDialog.canceled || !saveDialog.filePath) {
      return { ok: false, cancelled: true, message: 'Save cancelled' } as const;
    }
    const result = await saveStandaloneHtmlAtomically(saveDialog.filePath, content);
    return result.ok
      ? { ok: true, path: result.path } as const
      : { ok: false, message: boundedSaveError(result.message) } as const;
  });
  ipcMain.handle(IPC_CHANNELS.previewConfigureNetwork, (event, request) => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Preview network policy must come from the main renderer frame');
    }
    previewSecurity.configure(event.sender.id, validatePreviewNetworkPolicy(request));
  });
  ipcMain.handle(IPC_CHANNELS.previewReleaseNetwork, (event, previewId) => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Preview network release must come from the main renderer frame');
    }
    previewSecurity.release(event.sender.id, validatePreviewId(previewId));
  });
};

const boundedSaveError = (message: string): string =>
  (message.trim() || 'Unable to save file').slice(0, 512);

const assertMainFrame = (event: IpcMainInvokeEvent, operation: string): void => {
  if (event.senderFrame !== event.sender.mainFrame) {
    throw new Error(`${operation} must come from the main renderer frame`);
  }
};

const validatePreviewId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid preview id');
  }
  return value;
};

const validateSoftDeleteToken = (value: unknown): SoftDeleteToken => {
  const token = record(value, 'soft delete token');
  return {
    componentId: validateId(token.componentId, 'component id'),
    deletedAt: validateIsoTimestamp(token.deletedAt, 'deleted timestamp'),
    expiresAt: validateIsoTimestamp(token.expiresAt, 'delete expiry'),
  };
};

const validateIsoTimestamp = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${name}`);
  return value;
};

const validateExternalUrl = (value: unknown): string => {
  const url = validateString(value, 'external URL', 500, false);
  if (url !== 'https://github.com/uni928/PropertyHTML') throw new Error('External URL is not allowed');
  return url;
};

const validatePreviewNetworkPolicy = (value: unknown): PreviewNetworkPolicyRequest => {
  const input = record(value, 'preview network policy');
  if (typeof input.previewId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(input.previewId)
    || !Array.isArray(input.allowedOrigins)
    || input.allowedOrigins.length > 64
    || !input.allowedOrigins.every(isHttpsOrigin)) {
    throw new Error('Invalid preview network policy');
  }
  return {
    previewId: input.previewId,
    allowedOrigins: [...new Set(input.allowedOrigins)],
  };
};

const validateLibrary = (value: unknown): LibrarySaveInput => {
  const input = record(value, 'library');
  return {
    ...(input.id === undefined ? {} : { id: validateId(input.id, 'library id') }),
    name: validateString(input.name, 'library name', 255, false),
    description: validateString(input.description, 'library description', 10_000),
  };
};

const validateComponent = (value: unknown): ComponentSaveInput => {
  const input = record(value, 'component');
  if (!Array.isArray(input.tags) || !input.tags.every(tag => isStringWithin(tag, 100))) {
    throw new Error('Invalid component tags');
  }
  if (!isPreviewPolicy(input.previewPolicy)) throw new Error('Invalid preview policy');
  if (input.originalFileName !== null && !isStringWithin(input.originalFileName, 255)) {
    throw new Error('Invalid original filename');
  }
  return {
    ...(input.id === undefined ? {} : { id: validateId(input.id, 'component id') }),
    libraryId: validateId(input.libraryId, 'library id'),
    name: validateString(input.name, 'component name', 255, false),
    description: validateString(input.description, 'component description', 10_000),
    category: validateString(input.category, 'component category', 255),
    html: validateString(input.html, 'component HTML', 2_000_000),
    css: validateString(input.css, 'component CSS', 2_000_000),
    javascript: validateString(input.javascript, 'component JavaScript', 2_000_000),
    sourceType: validateString(input.sourceType, 'component source type', 64, false),
    originalFileName: input.originalFileName as string | null,
    tags: input.tags as string[],
    previewPolicy: input.previewPolicy,
  };
};

const validateSettingsPatch = (value: unknown): Partial<AppSettings> => {
  const patch = record(value, 'settings');
  const allowedKeys = new Set([
    'viewMode', 'galleryColumns', 'editorPreviewRatio', 'studioPaneRatios', 'lastLibraryId', 'lastComponentId',
  ]);
  if (Object.keys(patch).some(key => !allowedKeys.has(key))) throw new Error('Unknown application setting');
  const candidate = { ...defaultSettingsForValidation, ...patch };
  if (!isAppSettings(candidate)) throw new Error('Invalid application settings');
  if (patch.lastLibraryId !== undefined && patch.lastLibraryId !== null) validateId(patch.lastLibraryId, 'last library id');
  if (patch.lastComponentId !== undefined && patch.lastComponentId !== null) validateId(patch.lastComponentId, 'last component id');
  return patch as Partial<AppSettings>;
};

const validateImportPaths = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error('Invalid import paths');
  }
  return value.map(path => validateString(path, 'import path', 4_096, false));
};

const validateImportOptions = (value: unknown): HtmlImportOptions => {
  if (value === undefined) return {};
  const options = record(value, 'import options');
  if (Object.keys(options).some(key => key !== 'allowLargeFiles') ||
    (options.allowLargeFiles !== undefined && typeof options.allowLargeFiles !== 'boolean')) {
    throw new Error('Invalid import options');
  }
  return options as HtmlImportOptions;
};

const defaultSettingsForValidation: AppSettings = {
  viewMode: 'workbench', galleryColumns: 3, editorPreviewRatio: 0.55,
  studioPaneRatios: [0.24, 0.42, 0.34], lastLibraryId: null, lastComponentId: null,
};

const record = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid ${name}`);
  return value as Record<string, unknown>;
};

const validateId = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
};

const validateString = (value: unknown, name: string, maximum: number, allowEmpty = true): string => {
  if (!isStringWithin(value, maximum) || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
};

const isStringWithin = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length <= maximum;
