import type { LibraryRecord } from '../../../../shared/contracts';

interface LibrarySidebarProps {
  libraries: LibraryRecord[];
  selectedLibraryId: string | null;
  onSelectLibrary: (libraryId: string | null) => void;
}

export const LibrarySidebar = ({ libraries, selectedLibraryId, onSelectLibrary }: LibrarySidebarProps) => (
  <aside className="library-sidebar">
    <div className="library-sidebar__brand">
      <span className="library-sidebar__mark" aria-hidden="true">CV</span>
      <div>
        <strong>Component Vault</strong>
        <span>Component workspace</span>
      </div>
    </div>

    <button type="button" className="new-component-button">New component</button>

    <label className="library-sidebar__search">
      <span className="sr-only">Search components</span>
      <input type="search" placeholder="Search components" aria-label="Search components" />
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
          <button type="button">Buttons</button>
          <button type="button">Forms</button>
          <button type="button">Layouts</button>
        </div>
      </section>
    </nav>

    <div className="library-sidebar__footer" aria-label="Library actions">
      <button type="button">Import</button>
      <button type="button">Export</button>
      <button type="button">Settings</button>
    </div>
  </aside>
);
