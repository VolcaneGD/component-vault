export type ViewMode = 'workbench' | 'gallery' | 'studio';

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
  deletedAt: string | null;
}

export interface LibraryRecord {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface PreviewPolicy {
  allowScripts: boolean;
  allowForms: boolean;
  allowPopups: boolean;
  externalNetworkEnabled?: boolean;
  allowedOrigins: string[];
}

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

export interface AppSettings {
  viewMode: ViewMode;
  galleryColumns: 1 | 2 | 3 | 4;
  editorPreviewRatio: number;
  studioPaneRatios: [number, number, number];
  lastLibraryId: string | null;
  lastComponentId: string | null;
}

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
  listLibraries: () => Promise<LibraryRecord[]>;
  saveLibrary: (library: LibrarySaveInput) => Promise<LibraryRecord>;
  deleteLibrary: (libraryId: string) => Promise<boolean>;
  listComponents: (libraryId: string) => Promise<ComponentRecord[]>;
  saveComponent: (component: ComponentSaveInput) => Promise<ComponentRecord>;
  deleteComponent: (componentId: string) => Promise<boolean>;
  reorderComponents: (libraryId: string, componentIds: string[]) => Promise<void>;
  searchComponents: (libraryId: string, query: string) => Promise<ComponentRecord[]>;
  getAppSettings: () => Promise<AppSettings>;
  saveAppSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}

export const defaultAppSettings = (): AppSettings => ({
  viewMode: 'workbench',
  galleryColumns: 3,
  editorPreviewRatio: 0.55,
  studioPaneRatios: [0.24, 0.42, 0.34],
  lastLibraryId: null,
  lastComponentId: null,
});

export const isViewMode = (value: unknown): value is ViewMode =>
  value === 'workbench' || value === 'gallery' || value === 'studio';

const isHttpsOrigin = (value: unknown): value is string => {
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
