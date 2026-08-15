import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react';
import type { ComponentRecord, ComponentSaveInput, ViewMode } from '../../../../shared/contracts';
import { LibrarySidebar } from '../library/LibrarySidebar';
import { useAppStore } from '../../store/useAppStore';
import { ViewSwitcher } from './ViewSwitcher';
import { ImportDialog } from '../import/ImportDialog';
import { ExportDialog } from '../export/ExportDialog';
import { CommandPalette, type CommandDefinition } from '../commands/CommandPalette';
import { UndoToast } from '../feedback/UndoToast';
import { AboutDialog } from '../about/AboutDialog';

const WorkbenchPlaceholder = lazy(() => import('./WorkbenchView'));
const GalleryPlaceholder = lazy(() => import('../library/GalleryView'));
const StudioPlaceholder = lazy(() => import('../studio/AdaptiveStudio'));

const modeContent: Record<ViewMode, LazyExoticComponent<ComponentType>> = {
  workbench: WorkbenchPlaceholder,
  gallery: GalleryPlaceholder,
  studio: StudioPlaceholder,
};

const toSaveInput = (component: ComponentRecord): ComponentSaveInput => ({
  id: component.id.startsWith('draft:') ? undefined : component.id,
  libraryId: component.libraryId,
  name: component.name,
  description: component.description,
  category: component.category,
  html: component.html,
  css: component.css,
  javascript: component.javascript,
  sourceType: component.sourceType,
  originalFileName: component.originalFileName,
  tags: component.tags,
  previewPolicy: component.previewPolicy,
});

const ownsEditingShortcut = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, [contenteditable="true"]')
    || Boolean(target.closest('.monaco-editor'));
};

export const AppShell = () => {
  const {
    settings,
    libraries,
    components,
    selectedLibraryId,
    selectedComponentId,
    selectedComponentIds,
    hydrate,
    setSelectedLibraryId,
    setViewMode,
    beginCodeComponent,
    acceptSavedComponents,
    acceptLibrary,
    saveComponent,
    pendingDeletions,
    undoDelete,
    expireDeletion,
  } = useAppStore();
  const [importMode, setImportMode] = useState<'files' | 'code' | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [paletteReturnFocus, setPaletteReturnFocus] = useState<HTMLElement | null>(null);
  const paletteButtonRef = useRef<HTMLButtonElement>(null);
  const ModeContent = modeContent[settings.viewMode];
  const exportLibrary = libraries.find((library) => library.id === selectedLibraryId) ?? libraries[0] ?? null;
  const exportComponents = exportLibrary
    ? components.filter((component) => component.libraryId === exportLibrary.id && !component.id.startsWith('draft:'))
    : [];

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const openPalette = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k'
        || ownsEditingShortcut(event.target)) return;
      event.preventDefault();
      const activeElement = document.activeElement;
      setPaletteReturnFocus(activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : paletteButtonRef.current);
      setPaletteOpen(true);
    };
    window.addEventListener('keydown', openPalette);
    return () => window.removeEventListener('keydown', openPalette);
  }, []);

  const commands = useMemo<CommandDefinition[]>(() => {
    const selected = components.find((component) => component.id === selectedComponentId)
      ?? components.find((component) => component.id === selectedComponentIds[0]);
    const focusSearch = () => window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('[aria-label="Search components"]')?.focus();
    });
    return [
      { id: 'new', label: 'New component', group: 'Create', keywords: ['code'], run: () => setImportMode('code') },
      { id: 'search', label: 'Search components', group: 'Navigate', shortcut: '/', run: focusSearch },
      { id: 'view-workbench', label: 'View Workbench', group: 'View', keywords: ['A editor preview'], run: () => setViewMode('workbench') },
      { id: 'view-gallery', label: 'View Gallery', group: 'View', keywords: ['B cards'], run: () => setViewMode('gallery') },
      { id: 'view-studio', label: 'View Adaptive Studio', group: 'View', keywords: ['C panes'], run: () => setViewMode('studio') },
      { id: 'save', label: 'Save current component', group: 'Component', shortcut: 'Ctrl+S', disabled: !selected, run: () => selected ? saveComponent(toSaveInput(selected)) : undefined },
      { id: 'import', label: 'Import HTML', group: 'File', run: () => setImportMode('files') },
      { id: 'export', label: 'Export library', group: 'File', disabled: !exportLibrary || exportComponents.length === 0, run: () => setExportOpen(true) },
      { id: 'about', label: 'About Component Vault', group: 'Help', run: () => setAboutOpen(true) },
    ];
  }, [components, selectedComponentId, selectedComponentIds, setViewMode, saveComponent, exportLibrary, exportComponents.length]);

  return (
    <div className="app-shell">
      <LibrarySidebar
        libraries={libraries}
        selectedLibraryId={selectedLibraryId}
        onSelectLibrary={setSelectedLibraryId}
        onNewComponent={() => setImportMode('code')}
        onImport={() => setImportMode('files')}
        onExport={exportLibrary && exportComponents.length > 0 ? () => setExportOpen(true) : undefined}
        onSettings={() => setAboutOpen(true)}
      />
      <main className="workspace" data-view={settings.viewMode}>
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Workspace</span>
            <h1>Component Vault</h1>
          </div>
          <ViewSwitcher value={settings.viewMode} onChange={setViewMode} />
          <button
            ref={paletteButtonRef}
            type="button"
            className="command-palette-trigger"
            aria-label="Open command palette"
            onClick={(event) => {
              setPaletteReturnFocus(event.currentTarget);
              setPaletteOpen(true);
            }}
          >
            <span>Commands</span><kbd>Ctrl K</kbd>
          </button>
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
      {paletteOpen && (
        <CommandPalette
          commands={commands}
          returnFocus={paletteReturnFocus ?? paletteButtonRef.current}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      <div className="undo-toast-stack" aria-label="Recent deletions">
        {pendingDeletions.map((pending) => (
          <UndoToast
            key={`${pending.token.componentId}:${pending.token.deletedAt}`}
            label={pending.component.name}
            expiresAt={Date.parse(pending.token.expiresAt)}
            onUndo={() => undoDelete(pending.token)}
            onExpire={() => expireDeletion(pending.token)}
          />
        ))}
      </div>
    </div>
  );
};
