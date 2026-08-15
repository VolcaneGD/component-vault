import type { ViewMode } from '../../../../shared/contracts';

interface ViewSwitcherProps {
  value: ViewMode;
  onChange: (viewMode: ViewMode) => void;
}

const modes: Array<{ value: ViewMode; label: string; description: string }> = [
  { value: 'workbench', label: 'A Workbench', description: 'Code and preview workspace' },
  { value: 'gallery', label: 'B Gallery', description: 'Component collection' },
  { value: 'studio', label: 'C Adaptive Studio', description: 'Responsive composition workspace' },
];

export const ViewSwitcher = ({ value, onChange }: ViewSwitcherProps) => (
  <div className="view-switcher" role="group" aria-label="Workspace view">
    {modes.map((mode) => (
      <button
        key={mode.value}
        type="button"
        className="view-switcher__button"
        aria-label={mode.label}
        aria-pressed={value === mode.value}
        onClick={() => onChange(mode.value)}
      >
        <span className="view-switcher__label">{mode.label}</span>
        <span className="sr-only">{mode.description}</span>
      </button>
    ))}
  </div>
);
