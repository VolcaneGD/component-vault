import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from 'react';
import type { PreviewPolicy } from '../../../../shared/contracts';
import { ComponentEditor } from '../editor/ComponentEditor';
import { PreviewHost } from '../preview/PreviewHost';
import { useAppStore } from '../../store/useAppStore';

type StudioRatios = [number, number, number];

interface AdaptiveStudioProps {
  ratios?: StudioRatios;
}

const STUDIO_BREAKPOINT = 1180;
const MIN_RATIOS: StudioRatios = [0.16, 0.34, 0.22];
const ROUNDING_PRECISION = 10_000;

const rounded = (value: number): number => Math.round(value * ROUNDING_PRECISION) / ROUNDING_PRECISION;

export const normalizeStudioRatios = (input: StudioRatios): StudioRatios => {
  const safe = input.map((value) => Number.isFinite(value) && value > 0 ? value : 0) as StudioRatios;
  const total = safe.reduce((sum, value) => sum + value, 0);
  const requested = total > 0
    ? safe.map((value) => value / total) as StudioRatios
    : [1 / 3, 1 / 3, 1 / 3] as StudioRatios;
  const distributable = 1 - MIN_RATIOS.reduce((sum, value) => sum + value, 0);
  const weights = requested.map((value, index) => Math.max(0, value - MIN_RATIOS[index])) as StudioRatios;
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const result = MIN_RATIOS.map((minimum, index) => minimum + distributable * (
    weightTotal > 0 ? weights[index] / weightTotal : 1 / MIN_RATIOS.length
  )) as StudioRatios;
  const first = rounded(result[0]);
  const second = rounded(result[1]);
  return [first, second, rounded(1 - first - second)];
};

const useNarrowStudio = () => {
  const [narrow, setNarrow] = useState(() => window.innerWidth < STUDIO_BREAKPOINT);
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < STUDIO_BREAKPOINT);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return narrow;
};

const ComponentList = ({
  selectedComponentId,
  onSelect,
  selectedOptionRef,
}: {
  selectedComponentId: string | null;
  onSelect: (componentId: string) => void;
  selectedOptionRef?: Ref<HTMLButtonElement>;
}) => {
  const { components, searchQuery, selectedTags } = useAppStore();
  const visible = components.filter((component) => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const text = [component.name, component.description, component.category, ...component.tags]
      .join('\n').toLocaleLowerCase();
    return (!query || text.includes(query))
      && selectedTags.every((tag) => component.tags.includes(tag));
  });

  return (
    <div className="studio-component-list" role="listbox" aria-label="Studio components">
      {visible.map((component) => (
        <button
          key={component.id}
          type="button"
          ref={component.id === selectedComponentId ? selectedOptionRef : undefined}
          role="option"
          aria-label={component.name}
          aria-selected={component.id === selectedComponentId}
          onClick={() => onSelect(component.id)}
        >
          <strong>{component.name}</strong>
          <span>{component.category || 'Uncategorized'}</span>
        </button>
      ))}
      {visible.length === 0 && <span className="studio-component-list__empty">No matching components</span>}
    </div>
  );
};

export const AdaptiveStudio = ({ ratios }: AdaptiveStudioProps) => {
  const {
    settings,
    libraries,
    components,
    componentsLibraryId,
    selectedLibraryId,
    selectedComponentId,
    loadComponents,
    setSelectedComponentId,
    updateComponentDraft,
    saveComponent,
    duplicateComponent,
    deleteComponent,
    updateLayout,
  } = useAppStore();
  const studioRef = useRef<HTMLDivElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerInitialFocusRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);
  const narrow = useNarrowStudio();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paneRatios, setPaneRatios] = useState<StudioRatios>(() =>
    normalizeStudioRatios(ratios ?? settings.studioPaneRatios));
  const activeLibraryId = selectedLibraryId ?? libraries[0]?.id ?? null;
  const component = useMemo(
    () => components.find((item) => item.id === selectedComponentId) ?? components[0] ?? null,
    [components, selectedComponentId],
  );

  useEffect(() => {
    setPaneRatios(normalizeStudioRatios(ratios ?? settings.studioPaneRatios));
  }, [ratios, settings.studioPaneRatios]);

  useEffect(() => {
    if (!activeLibraryId || componentsLibraryId === activeLibraryId) return;
    void loadComponents(activeLibraryId).catch(() => undefined);
  }, [activeLibraryId, componentsLibraryId, loadComponents]);

  useEffect(() => {
    if (component && component.id !== selectedComponentId) setSelectedComponentId(component.id);
  }, [component, selectedComponentId, setSelectedComponentId]);

  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);

  useEffect(() => {
    if (drawerOpen) {
      drawerWasOpen.current = true;
      drawerInitialFocusRef.current?.focus();
      if (!drawerInitialFocusRef.current) drawerCloseRef.current?.focus();
      return;
    }
    if (drawerWasOpen.current) {
      drawerWasOpen.current = false;
      drawerTriggerRef.current?.focus();
    }
  }, [drawerOpen]);

  const persistRatios = useCallback((next: StudioRatios) => {
    const normalized = normalizeStudioRatios(next);
    setPaneRatios(normalized);
    updateLayout({ studioPaneRatios: normalized });
  }, [updateLayout]);

  const adjustDivider = useCallback((divider: 0 | 1, delta: number, persistChange: boolean) => {
    const next = [...paneRatios] as StudioRatios;
    next[divider] += delta;
    next[divider + 1] -= delta;
    const normalized = normalizeStudioRatios(next);
    setPaneRatios(normalized);
    if (persistChange) updateLayout({ studioPaneRatios: normalized });
  }, [paneRatios, updateLayout]);

  const beginResize = useCallback((divider: 0 | 1, event: PointerEvent<HTMLDivElement>) => {
    const container = studioRef.current;
    if (!container) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const bounds = container.getBoundingClientRect();
    const startX = event.clientX;
    const startRatios = paneRatios;

    const move = (moveEvent: globalThis.PointerEvent) => {
      if (bounds.width <= 0) return;
      const delta = (moveEvent.clientX - startX) / bounds.width;
      const next = [...startRatios] as StudioRatios;
      next[divider] += delta;
      next[divider + 1] -= delta;
      setPaneRatios(normalizeStudioRatios(next));
    };
    const finish = (upEvent: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      if (bounds.width <= 0) return;
      const delta = (upEvent.clientX - startX) / bounds.width;
      const next = [...startRatios] as StudioRatios;
      next[divider] += delta;
      next[divider + 1] -= delta;
      persistRatios(next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  }, [paneRatios, persistRatios]);

  const resizeWithKeyboard = useCallback((divider: 0 | 1, event: KeyboardEvent<HTMLDivElement>) => {
    const increment = event.shiftKey ? 0.1 : 0.05;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      adjustDivider(divider, -increment, true);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      adjustDivider(divider, increment, true);
    }
  }, [adjustDivider]);

  const persistPreviewPolicy = useCallback(async (policy: PreviewPolicy) => {
    if (!component) throw new Error('No component is selected');
    const next = { ...component, previewPolicy: policy };
    updateComponentDraft(next);
    const saved = await saveComponent(next);
    return saved.previewPolicy;
  }, [component, saveComponent, updateComponentDraft]);

  const selectComponent = useCallback((componentId: string) => {
    setSelectedComponentId(componentId);
    setDrawerOpen(false);
  }, [setSelectedComponentId]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const handleDrawerKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === firstFocusable) {
      event.preventDefault();
      lastFocusable.focus();
    } else if (!event.shiftKey && document.activeElement === lastFocusable) {
      event.preventDefault();
      firstFocusable.focus();
    }
  }, [closeDrawer]);

  if (!component) {
    return (
      <section className="studio-empty workspace-panel" aria-label="Empty adaptive studio">
        <span className="eyebrow">Adaptive Studio</span>
        <h2>Create or import a component</h2>
        <p>The component list, editor, and live preview will appear together here.</p>
      </section>
    );
  }

  const style = {
    '--studio-list-ratio': String(paneRatios[0]),
    '--studio-editor-ratio': String(paneRatios[1]),
    '--studio-preview-ratio': String(paneRatios[2]),
  } as CSSProperties;

  return (
    <section className="adaptive-studio" aria-label="Adaptive Studio workspace">
      <header className="studio-toolbar">
        <div>
          <span className="eyebrow">Adaptive Studio</span>
          <h2>{component.name}</h2>
        </div>
        {narrow && (
          <button ref={drawerTriggerRef} type="button" className="button" onClick={() => setDrawerOpen(true)}>
            Open component list
          </button>
        )}
      </header>
      <div
        ref={studioRef}
        className={`adaptive-studio__panes${narrow ? ' adaptive-studio__panes--narrow' : ''}`}
        data-testid="adaptive-studio"
        style={style}
      >
        {!narrow && (
          <section className="studio-pane studio-pane--list" aria-label="Component list pane">
            <ComponentList selectedComponentId={selectedComponentId} onSelect={selectComponent} />
          </section>
        )}
        {!narrow && (
          <div
            className="studio-splitter"
            role="separator"
            aria-label="Resize component list and editor"
            aria-orientation="vertical"
            aria-valuemin={16}
            aria-valuemax={44}
            aria-valuenow={Math.round(paneRatios[0] * 100)}
            tabIndex={0}
            onPointerDown={(event) => beginResize(0, event)}
            onKeyDown={(event) => resizeWithKeyboard(0, event)}
          ><span aria-hidden="true" /></div>
        )}
        <section className="studio-pane studio-pane--editor" aria-label="Editor pane">
          <ComponentEditor
            component={component}
            onChange={updateComponentDraft}
            onSave={saveComponent}
            onDuplicate={duplicateComponent}
            onDelete={deleteComponent}
          />
        </section>
        <div
          className="studio-splitter"
          role="separator"
          aria-label="Resize editor and preview"
          aria-orientation="vertical"
          aria-valuemin={34}
          aria-valuemax={70}
          aria-valuenow={Math.round(paneRatios[1] * 100)}
          tabIndex={0}
          onPointerDown={(event) => beginResize(1, event)}
          onKeyDown={(event) => resizeWithKeyboard(1, event)}
        ><span aria-hidden="true" /></div>
        <section className="studio-pane studio-pane--preview" aria-label="Live preview pane">
          <div className="studio-pane__heading">
            <span>Live Preview</span>
            <span className="status-dot">Isolated</span>
          </div>
          <PreviewHost component={component} onPreviewPolicyChange={persistPreviewPolicy} />
        </section>
      </div>

      {narrow && drawerOpen && (
        <div className="studio-drawer-backdrop" onMouseDown={closeDrawer}>
          <section
            ref={drawerRef}
            className="studio-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Component list"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={handleDrawerKeyDown}
          >
            <header>
              <strong>Components</strong>
              <button ref={drawerCloseRef} type="button" className="button button--icon" aria-label="Close component list" onClick={closeDrawer}>×</button>
            </header>
            <ComponentList
              selectedComponentId={selectedComponentId}
              onSelect={selectComponent}
              selectedOptionRef={drawerInitialFocusRef}
            />
          </section>
        </div>
      )}
    </section>
  );
};

export default AdaptiveStudio;
