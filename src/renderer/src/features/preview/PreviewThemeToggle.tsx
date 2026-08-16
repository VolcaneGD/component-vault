import { t } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';

export const PreviewThemeToggle = () => {
  const { settings, updateLayout } = useAppStore();
  const setTheme = (previewTheme: 'light' | 'dark') => updateLayout({ previewTheme });

  return (
    <div className="preview-theme-toggle" role="group" aria-label={t(settings.language, 'previewBackground')}>
      <button type="button" aria-label={t(settings.language, 'lightPreviewBackground')} aria-pressed={settings.previewTheme === 'light'} onClick={() => setTheme('light')}>
        {t(settings.language, 'light')}
      </button>
      <button type="button" aria-label={t(settings.language, 'darkPreviewBackground')} aria-pressed={settings.previewTheme === 'dark'} onClick={() => setTheme('dark')}>
        {t(settings.language, 'dark')}
      </button>
    </div>
  );
};
