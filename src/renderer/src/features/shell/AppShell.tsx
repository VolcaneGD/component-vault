import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react';
import type { ComponentRecord, ComponentSaveInput, ViewMode } from '../../../../shared/contracts';
import { LibrarySidebar, type SidebarContextAction, type SidebarContextTarget } from '../library/LibrarySidebar';
import { useAppStore } from '../../store/useAppStore';
import { ViewSwitcher } from './ViewSwitcher';
import { ImportDialog } from '../import/ImportDialog';
import { ExportDialog } from '../export/ExportDialog';
import { CommandPalette, type CommandDefinition } from '../commands/CommandPalette';
import { UndoToast } from '../feedback/UndoToast';
import { AboutDialog } from '../about/AboutDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { QuickCreateDialog, type QuickCreateKind } from '../library/QuickCreateDialog';
import { DeleteLibraryDialog, RenameDialog } from '../library/ContextActionDialog';
import { t } from '../../i18n';

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
    componentsLibraryId,
    hydrate,
    setSelectedLibraryId,
    setViewMode,
    updateLayout,
    beginCodeComponent,
    ensureEditableComponent,
    setSelectedComponentId,
    updateComponentDraft,
    acceptSavedComponents,
    acceptLibrary,
    deleteLibrary,
    saveComponent,
    duplicateComponent,
    deleteComponent,
    pendingDeletions,
    undoDelete,
    expireDeletion,
    handleExternalLibraryChanged,
  } = useAppStore();
  const [importMode, setImportMode] = useState<'files' | 'code' | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickCreateKind, setQuickCreateKind] = useState<QuickCreateKind | null>(null);
  const [renameTarget, setRenameTarget] = useState<SidebarContextTarget | null>(null);
  const [deleteLibraryTarget, setDeleteLibraryTarget] = useState<SidebarContextTarget | null>(null);
  const [aboutReturnFocus, setAboutReturnFocus] = useState<HTMLElement | null>(null);
  const [paletteReturnFocus, setPaletteReturnFocus] = useState<HTMLElement | null>(null);
  const paletteButtonRef = useRef<HTMLButtonElement>(null);
  const editableLibraryRef = useRef<string | null>(null);
  const ModeContent = modeContent[settings.viewMode];
  const exportLibrary = libraries.find((library) => library.id === selectedLibraryId) ?? libraries[0] ?? null;
  const exportComponents = exportLibrary
    ? components.filter((component) => component.libraryId === exportLibrary.id && !component.id.startsWith('draft:'))
    : [];

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => window.componentVault?.onLibraryChanged?.(event => {
    void handleExternalLibraryChanged(event);
  }), [handleExternalLibraryChanged]);

  useEffect(() => {
    if (!selectedLibraryId || componentsLibraryId !== selectedLibraryId) return;
    if (components.length > 0) {
      editableLibraryRef.current = selectedLibraryId;
      return;
    }
    if (editableLibraryRef.current === selectedLibraryId) return;
    editableLibraryRef.current = selectedLibraryId;
    ensureEditableComponent(selectedLibraryId);
  }, [components.length, componentsLibraryId, ensureEditableComponent, selectedLibraryId]);

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
      document.querySelector<HTMLInputElement>(`[aria-label="${t(settings.language, 'searchComponents')}"]`)?.focus();
    });
    return [
      { id: 'new', label: t(settings.language, 'newComponent'), group: settings.language === 'ja' ? '作成' : 'Create', keywords: ['code'], run: () => setImportMode('code') },
      { id: 'search', label: t(settings.language, 'searchComponents'), group: settings.language === 'ja' ? '移動' : 'Navigate', shortcut: '/', run: focusSearch },
      { id: 'view-workbench', label: `${settings.language === 'ja' ? '表示' : 'View'} ${t(settings.language, 'workbench')}`, group: settings.language === 'ja' ? '表示' : 'View', keywords: ['A editor preview'], run: () => setViewMode('workbench') },
      { id: 'view-gallery', label: `${settings.language === 'ja' ? '表示' : 'View'} ${t(settings.language, 'gallery')}`, group: settings.language === 'ja' ? '表示' : 'View', keywords: ['B cards'], run: () => setViewMode('gallery') },
      { id: 'view-studio', label: `${settings.language === 'ja' ? '表示' : 'View'} ${t(settings.language, 'adaptiveStudio')}`, group: settings.language === 'ja' ? '表示' : 'View', keywords: ['C panes'], run: () => setViewMode('studio') },
      { id: 'save', label: settings.language === 'ja' ? '現在のコンポーネントを保存' : 'Save current component', group: settings.language === 'ja' ? 'コンポーネント' : 'Component', shortcut: 'Ctrl+S', disabled: !selected, run: () => selected ? saveComponent(toSaveInput(selected)) : undefined },
      { id: 'import', label: settings.language === 'ja' ? 'HTMLをインポート' : 'Import HTML', group: settings.language === 'ja' ? 'ファイル' : 'File', run: () => setImportMode('files') },
      { id: 'export', label: settings.language === 'ja' ? 'ライブラリをエクスポート' : 'Export library', group: settings.language === 'ja' ? 'ファイル' : 'File', disabled: !exportLibrary || exportComponents.length === 0, run: () => setExportOpen(true) },
      { id: 'about', label: t(settings.language, 'about'), group: settings.language === 'ja' ? 'ヘルプ' : 'Help', run: () => {
        setAboutReturnFocus(paletteReturnFocus ?? paletteButtonRef.current);
        setAboutOpen(true);
      } },
    ];
  }, [components, selectedComponentId, selectedComponentIds, setViewMode, saveComponent, exportLibrary, exportComponents.length, paletteReturnFocus, settings.language]);

  return (
    <div className="app-shell">
      <div className="native-titlebar-drag-region" aria-hidden="true" />
      <LibrarySidebar
        libraries={libraries}
        selectedLibraryId={selectedLibraryId}
        onSelectLibrary={setSelectedLibraryId}
        onSelectComponent={setSelectedComponentId}
        onAddLibrary={() => setQuickCreateKind('library')}
        onAddTag={() => setQuickCreateKind('tag')}
        onContextAction={(target: SidebarContextTarget, action: SidebarContextAction) => {
          if (action === 'open') {
            if (target.kind === 'library') setSelectedLibraryId(target.value.id);
            else {
              setSelectedComponentId(target.value.id);
              setViewMode('workbench');
            }
            return;
          }
          if (action === 'rename') {
            setRenameTarget(target);
            return;
          }
          if (action === 'duplicate' && target.kind === 'component') {
            void duplicateComponent(target.value);
            return;
          }
          if (action === 'delete' && target.kind === 'component') {
            void deleteComponent(target.value.id);
            return;
          }
          if (action === 'delete' && target.kind === 'library') setDeleteLibraryTarget(target);
        }}
        onNewComponent={() => setImportMode('code')}
        onImport={() => setImportMode('files')}
        onExport={exportLibrary && exportComponents.length > 0 ? () => setExportOpen(true) : undefined}
        onSettings={(origin) => {
          setAboutReturnFocus(origin);
          setSettingsOpen(true);
        }}
      />
      <main className="workspace" data-view={settings.viewMode}>
        <header className="workspace-header">
          <div>
            <span className="eyebrow">{t(settings.language, 'workspace')}</span>
            <h1>Component Vault</h1>
          </div>
          <ViewSwitcher value={settings.viewMode} onChange={setViewMode} />
          <button
            ref={paletteButtonRef}
            type="button"
            className="command-palette-trigger"
            aria-label={t(settings.language, 'openCommandPalette')}
            onClick={(event) => {
              setPaletteReturnFocus(event.currentTarget);
              setPaletteOpen(true);
            }}
          >
            <span>{t(settings.language, 'commands')}</span><kbd>Ctrl K</kbd>
          </button>
        </header>
        <Suspense fallback={<div className="mode-placeholder" aria-live="polite">{t(settings.language, 'loadingWorkspace')}</div>}>
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
      {aboutOpen && (
        <AboutDialog returnFocus={aboutReturnFocus} onClose={() => setAboutOpen(false)} />
      )}
      {settingsOpen && (
        <SettingsDialog
          language={settings.language}
          onLanguageChange={(language) => updateLayout({ language })}
          returnFocus={aboutReturnFocus}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {quickCreateKind && (
        <QuickCreateDialog
          kind={quickCreateKind}
          language={settings.language}
          onClose={() => setQuickCreateKind(null)}
          onSubmit={async (name) => {
            if (quickCreateKind === 'library') {
              const library = await window.componentVault.saveLibrary({ name, description: '' });
              acceptLibrary(library);
              ensureEditableComponent(library.id);
              return;
            }
            const component = components.find((item) => item.id === selectedComponentId);
            if (!component) throw new Error('No component is selected');
            const tags = Array.from(new Set([...component.tags, name]));
            const updated = { ...component, tags, updatedAt: new Date().toISOString() };
            updateComponentDraft(updated);
            if (!component.id.startsWith('draft:')) {
              await saveComponent(toSaveInput(updated));
            }
          }}
        />
      )}
      {renameTarget && (
        <RenameDialog
          language={settings.language}
          initialName={renameTarget.value.name}
          target={renameTarget.kind}
          onClose={() => setRenameTarget(null)}
          onConfirm={async (name) => {
            if (renameTarget.kind === 'library') {
              acceptLibrary(await window.componentVault.saveLibrary({ ...renameTarget.value, name }));
              return;
            }
            const renamed = { ...renameTarget.value, name, updatedAt: new Date().toISOString() };
            updateComponentDraft(renamed);
            await saveComponent(toSaveInput(renamed));
          }}
        />
      )}
      {deleteLibraryTarget?.kind === 'library' && (
        <DeleteLibraryDialog
          language={settings.language}
          onClose={() => setDeleteLibraryTarget(null)}
          onConfirm={() => deleteLibrary(deleteLibraryTarget.value.id)}
        />
      )}
      <div className="undo-toast-stack" aria-label={t(settings.language, 'recentDeletions')}>
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
