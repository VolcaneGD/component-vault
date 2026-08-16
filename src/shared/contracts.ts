export type ViewMode = 'workbench' | 'gallery' | 'studio';
export type PreviewTheme = 'light' | 'dark';

export interface ComponentRecord {
  id: string;
  libraryId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  html: string;
  css: string;
  javascript: string;
  sourceType: string;
  originalFileName: string | null;
  previewPolicy: PreviewPolicy;
  createdAt: string;
  updatedAt: string;
  revision?: number;
  deletedAt: string | null;
}

export interface LibraryRecord {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  revision?: number;
}

export interface PreviewPolicy {
  allowScripts: boolean;
  allowForms: boolean;
  allowPopups: boolean;
  externalNetworkEnabled?: boolean;
  allowedOrigins: string[];
}

export interface PreviewNetworkPolicyRequest {
  previewId: string;
  allowedOrigins: string[];
}

export interface PreviewBlockedRequest {
  previewId: string;
  url: string;
  origin: string;
}

export interface LibraryChangedEvent {
  libraryId: string | null;
  revision: number | null;
  command: string;
}

export const PREVIEW_REQUEST_BLOCKED_CHANNEL = 'preview:request-blocked';

export interface LibrarySaveInput {
  id?: string;
  name: string;
  description: string;
}

export interface ComponentSaveInput {
  id?: string;
  libraryId: string;
  name: string;
  description: string;
  category: string;
  html: string;
  css: string;
  javascript: string;
  sourceType: string;
  originalFileName: string | null;
  tags: string[];
  previewPolicy: PreviewPolicy;
}

export interface ComponentDraft {
  name: string;
  description: string;
  category: string;
  html: string;
  css: string;
  javascript: string;
  sourceType: 'import';
  originalFileName: string;
  tags: string[];
  previewPolicy: PreviewPolicy;
}

export interface SoftDeleteToken {
  componentId: string;
  deletedAt: string;
  expiresAt: string;
}

export interface RecoverySnapshot {
  libraryId: string;
  componentId: string;
  completedAt: string;
}

export interface ExportComponent {
  name: string;
  description: string;
  category: string;
  tags: string[];
  html: string;
  css: string;
  javascript: string;
  previewPolicy: PreviewPolicy;
}

export interface ExportPayload {
  format: 'component-vault';
  version: 1;
  library: {
    name: string;
    description: string;
  };
  components: ExportComponent[];
}

export type ExportCopyKind = 'html' | 'css' | 'javascript' | 'css-linked-html' | 'full-code';

export type SaveFileResult =
  | { ok: true; path: string }
  | { ok: false; cancelled?: boolean; message: string };

export type ImportResult =
  | { ok: true; draft: ComponentDraft }
  | { ok: true; fileName: string; bundle: ExportPayload }
  | { ok: false; fileName: string; message: string };

export interface HtmlImportOptions {
  allowLargeFiles?: boolean;
}

export interface AppSettings {
  language: AppLanguage;
  previewTheme: PreviewTheme;
  viewMode: ViewMode;
  galleryColumns: 1 | 2 | 3 | 4;
  editorPreviewRatio: number;
  studioPaneRatios: [number, number, number];
  lastLibraryId: string | null;
  lastComponentId: string | null;
}

export type AppLanguage = 'ja' | 'en';

export const isAppLanguage = (value: unknown): value is AppLanguage => value === 'ja' || value === 'en';

export interface WindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  isMaximized: boolean;
  displayId: string | null;
}

export interface ComponentVaultApi {
  getAppVersion: () => Promise<string>;
  getElectronVersion: () => Promise<string>;
  getRecoverySnapshot: () => Promise<RecoverySnapshot | null>;
  ackRecoverySnapshot: (snapshot: RecoverySnapshot) => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
  listLibraries: () => Promise<LibraryRecord[]>;
  saveLibrary: (library: LibrarySaveInput) => Promise<LibraryRecord>;
  deleteLibrary: (libraryId: string) => Promise<boolean>;
  listComponents: (libraryId: string) => Promise<ComponentRecord[]>;
  saveComponent: (component: ComponentSaveInput) => Promise<ComponentRecord>;
  deleteComponent: (componentId: string) => Promise<SoftDeleteToken | null>;
  restoreDeletedComponent: (token: SoftDeleteToken) => Promise<ComponentRecord | null>;
  finalizeDeletedComponent: (token: SoftDeleteToken) => Promise<boolean>;
  reorderComponents: (libraryId: string, componentIds: string[]) => Promise<void>;
  searchComponents: (libraryId: string, query: string) => Promise<ComponentRecord[]>;
  getAppSettings: () => Promise<AppSettings>;
  saveAppSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  importHtmlFiles: (paths: string[], options?: HtmlImportOptions) => Promise<ImportResult[]>;
  copyText: (text: string) => Promise<void>;
  saveStandaloneHtml: (payload: ExportPayload) => Promise<SaveFileResult>;
  saveCssFile: (suggestedFileName: string, css: string) => Promise<SaveFileResult>;
  getPathForFile: (file: File) => string;
  configurePreviewNetwork: (request: PreviewNetworkPolicyRequest) => Promise<void>;
  releasePreviewNetwork: (previewId: string) => Promise<void>;
  onPreviewRequestBlocked: (listener: (event: PreviewBlockedRequest) => void) => () => void;
  onLibraryChanged: (listener: (event: LibraryChangedEvent) => void) => () => void;
}

export const defaultAppSettings = (): AppSettings => ({
  language: 'en',
  previewTheme: 'light',
  viewMode: 'workbench',
  galleryColumns: 3,
  editorPreviewRatio: 0.55,
  studioPaneRatios: [0.24, 0.42, 0.34],
  lastLibraryId: null,
  lastComponentId: null,
});

export const isViewMode = (value: unknown): value is ViewMode =>
  value === 'workbench' || value === 'gallery' || value === 'studio';

export const isPreviewTheme = (value: unknown): value is PreviewTheme =>
  value === 'light' || value === 'dark';

export const isHttpsOrigin = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
};

export const isPreviewPolicy = (value: unknown): value is PreviewPolicy => {
  if (typeof value !== 'object' || value === null) return false;

  const policy = value as Record<string, unknown>;
  return (
    typeof policy.allowScripts === 'boolean' &&
    typeof policy.allowForms === 'boolean' &&
    typeof policy.allowPopups === 'boolean' &&
    (policy.externalNetworkEnabled === undefined ||
      typeof policy.externalNetworkEnabled === 'boolean') &&
    Array.isArray(policy.allowedOrigins) &&
    policy.allowedOrigins.every(isHttpsOrigin)
  );
};

declare global {
  interface Window {
    componentVault: ComponentVaultApi;
  }
}
