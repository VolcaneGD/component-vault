export type ViewMode = 'workbench' | 'gallery' | 'studio';

export interface ComponentRecord {
  id: string;
  libraryId: string;
  name: string;
  description: string;
  tags: string[];
  html: string;
  css: string;
  javascript: string;
  createdAt: string;
  updatedAt: string;
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
}

export interface ComponentVaultApi {
  getAppVersion: () => Promise<string>;
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

declare global {
  interface Window {
    componentVault: ComponentVaultApi;
  }
}
