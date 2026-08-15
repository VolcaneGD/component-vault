import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react';
import type { ViewMode } from '../../../../shared/contracts';
import { LibrarySidebar } from '../library/LibrarySidebar';
import { useAppStore } from '../../store/useAppStore';
import { ViewSwitcher } from './ViewSwitcher';

const WorkbenchPlaceholder = lazy(async () => ({
  default: () => (
    <div className="workbench-placeholder" aria-label="Workbench placeholder">
      <section className="workspace-panel workbench-placeholder__editor" aria-labelledby="editor-heading">
        <div className="workspace-panel__heading">
          <span>Editor</span>
          <span className="status-dot">Ready</span>
        </div>
        <h2 id="editor-heading">Select a component to edit</h2>
        <p>HTML, CSS, and JavaScript controls will appear here.</p>
      </section>
      <section className="workspace-panel workbench-placeholder__preview" aria-labelledby="preview-heading">
        <div className="workspace-panel__heading">
          <span>Live preview</span>
          <span>Isolated</span>
        </div>
        <h2 id="preview-heading">Preview is ready</h2>
        <p>The existing sandboxed preview architecture remains unchanged.</p>
      </section>
    </div>
  ),
}));

const GalleryPlaceholder = lazy(async () => ({
  default: () => (
    <section className="mode-placeholder" aria-labelledby="gallery-heading">
      <span className="eyebrow">Gallery</span>
      <h2 id="gallery-heading">Your component collection</h2>
      <p>Gallery cards and filtering controls will appear here.</p>
    </section>
  ),
}));

const StudioPlaceholder = lazy(async () => ({
  default: () => (
    <section className="mode-placeholder" aria-labelledby="studio-heading">
      <span className="eyebrow">Adaptive Studio</span>
      <h2 id="studio-heading">Compose responsive layouts</h2>
      <p>Adaptive controls will appear here while your selection stays available.</p>
    </section>
  ),
}));

const modeContent: Record<ViewMode, LazyExoticComponent<ComponentType>> = {
  workbench: WorkbenchPlaceholder,
  gallery: GalleryPlaceholder,
  studio: StudioPlaceholder,
};

export const AppShell = () => {
  const { settings, libraries, selectedLibraryId, hydrate, setSelectedLibraryId, setViewMode } = useAppStore();
  const ModeContent = modeContent[settings.viewMode];

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="app-shell">
      <LibrarySidebar
        libraries={libraries}
        selectedLibraryId={selectedLibraryId}
        onSelectLibrary={setSelectedLibraryId}
      />
      <main className="workspace" data-view={settings.viewMode}>
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Workspace</span>
            <h1>Component Vault</h1>
          </div>
          <ViewSwitcher value={settings.viewMode} onChange={setViewMode} />
        </header>
        <Suspense fallback={<div className="mode-placeholder" aria-live="polite">Loading workspace…</div>}>
          <ModeContent />
        </Suspense>
      </main>
    </div>
  );
};
