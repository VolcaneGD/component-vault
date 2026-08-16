import { defaultAppSettings, isAppLanguage, isViewMode, type AppSettings } from './contracts';

const isGalleryColumns = (value: unknown): value is AppSettings['galleryColumns'] =>
  value === 1 || value === 2 || value === 3 || value === 4;

const isRatio = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export const isAppSettings = (value: unknown): value is AppSettings => {
  if (typeof value !== 'object' || value === null) return false;

  const settings = value as Record<string, unknown>;
  return (
    (settings.language === undefined || isAppLanguage(settings.language)) &&
    isViewMode(settings.viewMode) &&
    isGalleryColumns(settings.galleryColumns) &&
    isRatio(settings.editorPreviewRatio) &&
    Array.isArray(settings.studioPaneRatios) &&
    settings.studioPaneRatios.length === 3 &&
    settings.studioPaneRatios.every(isRatio) &&
    (typeof settings.lastLibraryId === 'string' || settings.lastLibraryId === null) &&
    (typeof settings.lastComponentId === 'string' || settings.lastComponentId === null)
  );
};

export const normalizeAppSettings = (value: unknown): AppSettings | null => {
  if (!isAppSettings(value)) return null;
  return { ...defaultAppSettings(), ...value };
};
