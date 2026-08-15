import { defaultAppSettings, type AppSettings } from '../../shared/contracts';
import { isAppSettings } from '../../shared/validation';
import type { DatabaseContext } from '../database/database';

export interface SettingsService {
  getAppSettings: () => AppSettings;
  saveAppSettings: (patch: Partial<AppSettings>) => AppSettings;
}

const APP_SETTINGS_KEY = 'app-settings';

export const createSettingsService = ({ db }: DatabaseContext): SettingsService => {
  const getAppSettings = (): AppSettings => {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(APP_SETTINGS_KEY) as
      | { value: string }
      | undefined;
    if (!row) return defaultAppSettings();
    try {
      const saved = JSON.parse(row.value) as unknown;
      return isAppSettings(saved) ? saved : defaultAppSettings();
    } catch {
      return defaultAppSettings();
    }
  };

  const saveAppSettings = (patch: Partial<AppSettings>): AppSettings => {
    const next = { ...getAppSettings(), ...patch };
    if (!isAppSettings(next)) throw new Error('Invalid application settings');
    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(APP_SETTINGS_KEY, JSON.stringify(next));
    return next;
  };

  return { getAppSettings, saveAppSettings };
};
