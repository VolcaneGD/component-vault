import type { LibraryRecord } from '../../../../shared/contracts';
import { useAppStore } from '../../store/useAppStore';
import { t } from '../../i18n';

interface LibrarySidebarProps {
  libraries: LibraryRecord[];
  selectedLibraryId: string | null;
  onSelectLibrary: (libraryId: string | null) => void;
  onSelectComponent?: (componentId: string) => void;
  onAddLibrary?: () => void;
  onAddTag?: () => void;
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

    <div className="library-sidebar__footer" aria-label={translate('libraryActions')}>
      <button type="button" onClick={onImport}>{translate('import')}</button>
      <button type="button" disabled={!onExport} onClick={onExport}>{translate('export')}</button>
      <button type="button" onClick={(event) => onSettings?.(event.currentTarget)}>{translate('settings')}</button>
    </div>
    </aside>
  );
};
