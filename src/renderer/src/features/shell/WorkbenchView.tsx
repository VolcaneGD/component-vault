import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { PreviewPolicy } from '../../../../shared/contracts';
import { ComponentEditor } from '../editor/ComponentEditor';
import { PreviewHost } from '../preview/PreviewHost';
import { useAppStore } from '../../store/useAppStore';

const clampRatio = (ratio: number): number => Math.min(0.8, Math.max(0.25, ratio));

export const WorkbenchView = () => {
  const {
    settings,
    libraries,
    components,
    componentsLibraryId,
    selectedLibraryId,
    selectedComponentId,
    draftOrigins,
    loadComponents,
    setSelectedComponentId,
    updateComponentDraft,
    saveComponent,
    duplicateComponent,
    deleteComponent,
    updateLayout,
  } = useAppStore();
  const workbenchRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => clampRatio(settings.editorPreviewRatio));
  const activeLibraryId = selectedLibraryId ?? libraries[0]?.id ?? null;
  const component = useMemo(
    () => components.find((item) => item.id === selectedComponentId) ?? components[0] ?? null,
    [components, selectedComponentId],
  );

  useEffect(() => {
    setRatio(clampRatio(settings.editorPreviewRatio));
  }, [settings.editorPreviewRatio]);

  useEffect(() => {
    if (!activeLibraryId || componentsLibraryId === activeLibraryId) return;
    void loadComponents(activeLibraryId).catch(() => undefined);
  }, [activeLibraryId, componentsLibraryId, loadComponents]);

  useEffect(() => {
    if (component && component.id !== selectedComponentId) setSelectedComponentId(component.id);
  }, [component, selectedComponentId, setSelectedComponentId]);

  const persistRatio = useCallback((next: number) => {
    const clamped = clampRatio(next);
    setRatio(clamped);
    updateLayout({ editorPreviewRatio: clamped });
  }, [updateLayout]);

  const beginResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const container = workbenchRef.current;
    if (!container) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const bounds = container.getBoundingClientRect();

    const move = (moveEvent: globalThis.PointerEvent) => {
      if (bounds.height <= 0) return;
      setRatio(clampRatio((moveEvent.clientY - bounds.top) / bounds.height));
    };
    const finish = (upEvent: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      if (bounds.height <= 0) return;
      persistRatio((upEvent.clientY - bounds.top) / bounds.height);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  }, [persistRatio]);

  const resizeWithKeyboard = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const increment = event.shiftKey ? 0.1 : 0.05;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      persistRatio(ratio - increment);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      persistRatio(ratio + increment);
    } else if (event.key === 'Home') {
      event.preventDefault();
      persistRatio(0.25);
    } else if (event.key === 'End') {
      event.preventDefault();
      persistRatio(0.8);
    }
  }, [persistRatio, ratio]);

  const persistPreviewPolicy = useCallback(async (policy: PreviewPolicy) => {
    if (!component) throw new Error('No component is selected');
    const componentWithPolicy = { ...component, previewPolicy: policy };
    updateComponentDraft(componentWithPolicy);
    const saved = await saveComponent(componentWithPolicy);
    return saved.previewPolicy;
  }, [component, saveComponent, updateComponentDraft]);

  if (!component) {
    return (
      <section className="workbench-empty workspace-panel" aria-label="Empty workbench">
        <span className="eyebrow">Workbench</span>
        <h2>Create or import a component</h2>
        <p>Your HTML, CSS, JavaScript, and isolated live preview will appear here.</p>
      </section>
    );
  }

  return (
    <div
      ref={workbenchRef}
      className="workbench"
      aria-label="Component workbench"
      style={{ gridTemplateRows: `minmax(10rem, ${ratio}fr) 0.55rem minmax(10rem, ${1 - ratio}fr)` }}
    >
      <ComponentEditor
        component={component}
        draftOriginId={draftOrigins[component.id]}
        isNew={component.id.startsWith('draft:')}
        autoFocusHtml={component.id.startsWith('draft:')}
        onChange={updateComponentDraft}
        onSave={saveComponent}
        onDuplicate={duplicateComponent}
        onDelete={deleteComponent}
      />
      <div
        className="workbench__splitter"
        role="separator"
        aria-label="Resize editor and preview"
        aria-orientation="horizontal"
        aria-valuemin={25}
        aria-valuemax={80}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        onPointerDown={beginResize}
        onKeyDown={resizeWithKeyboard}
      >
        <span aria-hidden="true" />
      </div>
      <div className="workbench__preview-panel">
        <div className="workbench__preview-heading">
          <span>Live Preview</span>
          <span className="status-dot">Isolated</span>
        </div>
        <PreviewHost component={component} onPreviewPolicyChange={persistPreviewPolicy} />
      </div>
    </div>
  );
};

export default WorkbenchView;
