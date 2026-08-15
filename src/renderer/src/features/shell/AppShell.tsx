import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react';
import type { ViewMode } from '../../../../shared/contracts';
import { LibrarySidebar } from '../library/LibrarySidebar';
import { useAppStore } from '../../store/useAppStore';
import { ViewSwitcher } from './ViewSwitcher';

const WorkbenchPlaceholder = lazy(() => import('./WorkbenchView'));
const GalleryPlaceholder = lazy(() => import('./GalleryView'));
const StudioPlaceholder = lazy(() => import('./AdaptiveStudioView'));

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
