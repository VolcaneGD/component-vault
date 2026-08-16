import type { ViewMode } from '../../../../shared/contracts';
import { useAppStore } from '../../store/useAppStore';
import { t } from '../../i18n';

interface ViewSwitcherProps {
  value: ViewMode;
  onChange: (viewMode: ViewMode) => void;
}

const modes: Array<{ value: ViewMode; label: 'workbench' | 'gallery' | 'adaptiveStudio'; description: 'codeAndPreviewWorkspace' | 'componentCollection' | 'responsiveCompositionWorkspace'; prefix: string }> = [
  { value: 'workbench', prefix: 'A', label: 'workbench', description: 'codeAndPreviewWorkspace' },
  { value: 'gallery', prefix: 'B', label: 'gallery', description: 'componentCollection' },
  { value: 'studio', prefix: 'C', label: 'adaptiveStudio', description: 'responsiveCompositionWorkspace' },
];

export const ViewSwitcher = ({ value, onChange }: ViewSwitcherProps) => {
  const language = useAppStore((state) => state.settings.language);
  return <div className="view-switcher" role="group" aria-label={t(language, 'workspaceView')}>
    {modes.map((mode) => (
      <button
        key={mode.value}
        type="button"
        className="view-switcher__button"
        aria-label={`${mode.prefix} ${t(language, mode.label)}`}
        aria-pressed={value === mode.value}
        onClick={() => onChange(mode.value)}
      >
        <span className="view-switcher__label">{mode.prefix} {t(language, mode.label)}</span>
        <span className="sr-only">{t(language, mode.description)}</span>
      </button>
    ))}
  </div>;
};
