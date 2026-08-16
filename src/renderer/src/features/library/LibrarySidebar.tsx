import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ComponentRecord, LibraryRecord } from '../../../../shared/contracts';
import { useAppStore } from '../../store/useAppStore';
import { t } from '../../i18n';

export type SidebarContextTarget =
  | { kind: 'library'; value: LibraryRecord }
  | { kind: 'component'; value: ComponentRecord };

export type SidebarContextAction = 'open' | 'rename' | 'duplicate' | 'delete';

interface LibrarySidebarProps {
  libraries: LibraryRecord[];
  selectedLibraryId: string | null;
  onSelectLibrary: (libraryId: string | null) => void;
  onSelectComponent?: (componentId: string) => void;
  onAddLibrary?: () => void;
  onAddTag?: () => void;
  onContextAction?: (target: SidebarContextTarget, action: SidebarContextAction) => void;
  onNewComponent?: () => void;
  onImport?: () => void;
  onExport?: () => void;
  onSettings?: (origin: HTMLButtonElement) => void;
}

export const LibrarySidebar = ({
  libraries,
  selectedLibraryId,
  onSelectLibrary,
  onSelectComponent,
  onAddLibrary,
  onAddTag,
  onContextAction,
  onNewComponent,
  onImport,
  onExport,
  onSettings,
}: LibrarySidebarProps) => {
  const { components, selectedComponentId, searchQuery, selectedTags, setSearchQuery, toggleTag, clearFilters, settings } = useAppStore();
  const translate = (key: Parameters<typeof t>[1]) => t(settings.language, key);
  const tags = Array.from(new Set(components.flatMap((component) => component.tags)))
    .sort((left, right) => left.localeCompare(right));
  const libraryComponents = selectedLibraryId
    ? components.filter((component) => component.libraryId === selectedLibraryId)
    : [];
  const [contextTarget, setContextTarget] = useState<SidebarContextTarget | null>(null);
  const [contextPosition, setContextPosition] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const firstContextMenuItemRef = useRef<HTMLButtonElement>(null);
  const contextOriginRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextTarget(null);
    };
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, []);

  useEffect(() => {
    if (!contextTarget) return;
    window.requestAnimationFrame(() => firstContextMenuItemRef.current?.focus());
  }, [contextTarget]);

  const openContextMenu = (target: SidebarContextTarget, x: number, y: number, origin: HTMLButtonElement) => {
    contextOriginRef.current = origin;
    setContextTarget(target);
    setContextPosition({ x, y });
  };
  const onItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, target: SidebarContextTarget) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    openContextMenu(target, bounds.left + 12, bounds.bottom + 4, event.currentTarget);
  };
  const triggerContextAction = (action: SidebarContextAction) => {
    if (contextTarget) onContextAction?.(contextTarget, action);
    setContextTarget(null);
  };

  return (
    <aside className="library-sidebar">
    <div className="library-sidebar__brand">
      <span className="library-sidebar__mark" aria-hidden="true">CV</span>
      <div>
        <strong>Component Vault</strong>
        <span>{translate('componentWorkspace')}</span>
      </div>
    </div>

    <button type="button" className="new-component-button" onClick={onNewComponent}>{translate('newComponent')}</button>

    <label className="library-sidebar__search">
      <span className="sr-only">{translate('searchComponents')}</span>
      <input
        type="search"
        placeholder={translate('searchComponents')}
        aria-label={translate('searchComponents')}
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />
    </label>

    <nav aria-label={translate('navigation')} className="library-sidebar__nav">
      <section aria-labelledby="libraries-heading">
        <div className="sidebar-heading-row">
          <h2 id="libraries-heading">{translate('libraries')}</h2>
          <button type="button" aria-label={translate('addLibrary')} onClick={onAddLibrary}>+</button>
        </div>
        <button
          type="button"
          className="library-sidebar__item"
          aria-pressed={selectedLibraryId === null}
          onClick={() => onSelectLibrary(null)}
        >
          {translate('allComponents')}
        </button>
        {libraries.map((library) => (
          <div key={library.id} className="library-sidebar__library-group">
            <button
              type="button"
              className="library-sidebar__item"
              aria-pressed={selectedLibraryId === library.id}
              onClick={() => onSelectLibrary(library.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                openContextMenu({ kind: 'library', value: library }, event.clientX, event.clientY, event.currentTarget);
              }}
              onKeyDown={(event) => onItemKeyDown(event, { kind: 'library', value: library })}
            >
              {library.name}
            </button>
            {selectedLibraryId === library.id && (
              <div className="library-sidebar__components" aria-label={translate('libraryComponents')}>
                {libraryComponents.map((component) => (
                  <button
                    key={component.id}
                    type="button"
                    className="library-sidebar__component"
                    aria-pressed={selectedComponentId === component.id}
                    onClick={() => onSelectComponent?.(component.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openContextMenu({ kind: 'component', value: component }, event.clientX, event.clientY, event.currentTarget);
                    }}
                    onKeyDown={(event) => onItemKeyDown(event, { kind: 'component', value: component })}
                  >
                    {component.name || translate('componentName')}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      <section aria-labelledby="tags-heading">
        <div className="sidebar-heading-row">
          <h2 id="tags-heading">{translate('tags')}</h2>
          <button type="button" aria-label={translate('addTag')} onClick={onAddTag}>+</button>
        </div>
        <p className="library-sidebar__tag-help">{translate('tagHelp')}</p>
        <div className="tag-list" aria-label={translate('componentTags')}>
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-label={`${translate('filterByTag')} ${tag}`}
              aria-pressed={selectedTags.includes(tag)}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
          {(searchQuery || selectedTags.length > 0) && (
            <button type="button" className="tag-list__clear" onClick={clearFilters}>{translate('clearFilters')}</button>
          )}
        </div>
      </section>
    </nav>

    {contextTarget && (
      <div
        ref={contextMenuRef}
        className="library-context-menu"
        role="menu"
        aria-label={contextTarget.kind === 'library' ? contextTarget.value.name : contextTarget.value.name}
        style={{ left: contextPosition.x, top: contextPosition.y }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setContextTarget(null);
            contextOriginRef.current?.focus();
          }
        }}
      >
        <button ref={firstContextMenuItemRef} type="button" role="menuitem" onClick={() => triggerContextAction('open')}>{translate('open')}</button>
        <button type="button" role="menuitem" onClick={() => triggerContextAction('rename')}>
          {translate(contextTarget.kind === 'library' ? 'renameLibrary' : 'renameComponent')}
        </button>
        {contextTarget.kind === 'component' && <button type="button" role="menuitem" onClick={() => triggerContextAction('duplicate')}>{translate('duplicate')}</button>}
        <button type="button" role="menuitem" className="danger-action" onClick={() => triggerContextAction('delete')}>
          {translate(contextTarget.kind === 'library' ? 'deleteLibrary' : 'deleteComponent')}
        </button>
      </div>
    )}

    <div className="library-sidebar__footer" aria-label={translate('libraryActions')}>
      <button type="button" onClick={onImport}>{translate('import')}</button>
      <button type="button" disabled={!onExport} onClick={onExport}>{translate('export')}</button>
      <button type="button" onClick={(event) => onSettings?.(event.currentTarget)}>{translate('settings')}</button>
    </div>
    </aside>
  );
};
