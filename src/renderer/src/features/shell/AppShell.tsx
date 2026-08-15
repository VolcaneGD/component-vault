import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react';
import type { ViewMode } from '../../../../shared/contracts';
import { LibrarySidebar } from '../library/LibrarySidebar';
import { useAppStore } from '../../store/useAppStore';
import { ViewSwitcher } from './ViewSwitcher';
import { ImportDialog } from '../import/ImportDialog';
import { ExportDialog } from '../export/ExportDialog';

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
    components,
    selectedLibraryId,
    selectedComponentIds,
    hydrate,
    setSelectedLibraryId,
    setViewMode,
    beginCodeComponent,
    acceptSavedComponents,
    acceptLibrary,
  } = useAppStore();
  const [importMode, setImportMode] = useState<'files' | 'code' | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const ModeContent = modeContent[settings.viewMode];
  const exportLibrary = libraries.find((library) => library.id === selectedLibraryId) ?? libraries[0] ?? null;
  const exportComponents = exportLibrary
    ? components.filter((component) => component.libraryId === exportLibrary.id && !component.id.startsWith('draft:'))
    : [];

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
        onExport={exportLibrary && exportComponents.length > 0 ? () => setExportOpen(true) : undefined}
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
      {exportOpen && exportLibrary && (
        <ExportDialog
          library={exportLibrary}
          components={exportComponents}
          initiallySelectedIds={selectedComponentIds}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
};
