import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react';
import type { ViewMode } from '../../../../shared/contracts';
import { LibrarySidebar } from '../library/LibrarySidebar';
import { useAppStore } from '../../store/useAppStore';
import { ViewSwitcher } from './ViewSwitcher';
import { ImportDialog } from '../import/ImportDialog';

const WorkbenchPlaceholder = lazy(() => import('./WorkbenchView'));
const GalleryPlaceholder = lazy(() => import('../library/GalleryView'));
const StudioPlaceholder = lazy(() => import('../studio/AdaptiveStudio'));

const modeContent: Record<ViewMode, LazyExoticComponent<ComponentType>> = {
  workbench: WorkbenchPlaceholder,
  gallery: GalleryPlaceholder,
  studio: StudioPlaceholder,
};

export const AppShell = () => {
  const {
    settings,
    libraries,
    selectedLibraryId,
    hydrate,
    setSelectedLibraryId,
    setViewMode,
    beginCodeComponent,
    acceptSavedComponents,
    acceptLibrary,
  } = useAppStore();
  const [importMode, setImportMode] = useState<'files' | 'code' | null>(null);
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
        onNewComponent={() => setImportMode('code')}
        onImport={() => setImportMode('files')}
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
      {importMode && (
        <ImportDialog
          mode={importMode}
          libraries={libraries}
          selectedLibraryId={selectedLibraryId}
          onClose={() => setImportMode(null)}
          onSaved={acceptSavedComponents}
          onLibraryCreated={acceptLibrary}
          onStartCode={(libraryId) => {
            beginCodeComponent(libraryId);
            setImportMode(null);
          }}
        />
      )}
    </div>
  );
};
