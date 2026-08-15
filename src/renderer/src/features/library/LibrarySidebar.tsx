import type { LibraryRecord } from '../../../../shared/contracts';
import { useAppStore } from '../../store/useAppStore';

interface LibrarySidebarProps {
  libraries: LibraryRecord[];
  selectedLibraryId: string | null;
  onSelectLibrary: (libraryId: string | null) => void;
  onNewComponent?: () => void;
  onImport?: () => void;
  onExport?: () => void;
  onSettings?: () => void;
}

export const LibrarySidebar = ({
  libraries,
  selectedLibraryId,
  onSelectLibrary,
  onNewComponent,
  onImport,
  onExport,
  onSettings,
}: LibrarySidebarProps) => {
  const { components, searchQuery, selectedTags, setSearchQuery, toggleTag, clearFilters } = useAppStore();
  const tags = Array.from(new Set(components.flatMap((component) => component.tags)))
    .sort((left, right) => left.localeCompare(right));

  return (
    <aside className="library-sidebar">
    <div className="library-sidebar__brand">
      <span className="library-sidebar__mark" aria-hidden="true">CV</span>
      <div>
        <strong>Component Vault</strong>
        <span>Component workspace</span>
      </div>
    </div>

    <button type="button" className="new-component-button" onClick={onNewComponent}>New component</button>

    <label className="library-sidebar__search">
      <span className="sr-only">Search components</span>
      <input
        type="search"
        placeholder="Search components"
        aria-label="Search components"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />
    </label>

    <nav aria-label="Component Vault navigation" className="library-sidebar__nav">
      <section aria-labelledby="libraries-heading">
        <div className="sidebar-heading-row">
          <h2 id="libraries-heading">Libraries</h2>
          <button type="button" aria-label="Add library">+</button>
        </div>
        <button
          type="button"
          className="library-sidebar__item"
          aria-pressed={selectedLibraryId === null}
          onClick={() => onSelectLibrary(null)}
        >
          All components
        </button>
        {libraries.map((library) => (
          <button
            key={library.id}
            type="button"
            className="library-sidebar__item"
            aria-pressed={selectedLibraryId === library.id}
            onClick={() => onSelectLibrary(library.id)}
          >
            {library.name}
          </button>
        ))}
      </section>

      <section aria-labelledby="tags-heading">
        <h2 id="tags-heading">Tags</h2>
        <div className="tag-list" aria-label="Component tags">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-label={`Filter by tag ${tag}`}
              aria-pressed={selectedTags.includes(tag)}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
          {(searchQuery || selectedTags.length > 0) && (
            <button type="button" className="tag-list__clear" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
      </section>
    </nav>

    <div className="library-sidebar__footer" aria-label="Library actions">
      <button type="button" onClick={onImport}>Import</button>
      <button type="button" disabled={!onExport} onClick={onExport}>Export</button>
      <button type="button" onClick={onSettings}>Settings</button>
    </div>
    </aside>
  );
};
