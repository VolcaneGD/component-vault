import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import type { ComponentRecord, PreviewPolicy } from '../../../../shared/contracts';
import { PreviewHost } from '../preview/PreviewHost';
import { useAppStore } from '../../store/useAppStore';

type GalleryColumns = 1 | 2 | 3 | 4;

interface GalleryViewProps {
  columns?: GalleryColumns;
}

const VIRTUALIZATION_THRESHOLD = 100;
const VIRTUAL_WINDOW_SIZE = 48;
const ESTIMATED_CARD_HEIGHT = 290;
const DESCRIPTION_SNIPPET_LENGTH = 96;
const DESCRIPTION_MATCH_CONTEXT = 18;

const escapeExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const Highlight = ({ text, query }: { text: string; query: string }) => {
  const term = query.trim();
  if (!term) return text;
  const parts = text.split(new RegExp(`(${escapeExpression(term)})`, 'ig'));
  return parts.map((part, index) => part.toLocaleLowerCase() === term.toLocaleLowerCase()
    ? <mark key={`${part}-${index}`}>{part}</mark>
    : <span key={`${part}-${index}`}>{part}</span>);
};

const descriptionSnippet = (text: string, query: string): { text: string; contextual: boolean } => {
  const term = query.trim();
  if (text.length <= DESCRIPTION_SNIPPET_LENGTH) return { text, contextual: false };

  const matchIndex = term
    ? text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())
    : -1;
  if (matchIndex < 0) {
    return {
      text: `${text.slice(0, DESCRIPTION_SNIPPET_LENGTH - 1).trimEnd()}…`,
      contextual: false,
    };
  }

  const start = Math.max(0, matchIndex - DESCRIPTION_MATCH_CONTEXT);
  const end = Math.min(text.length, start + DESCRIPTION_SNIPPET_LENGTH);
  return {
    text: `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`,
    contextual: true,
  };
};

const matchesFilters = (component: ComponentRecord, query: string, tags: string[]): boolean => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchable = [
    component.name,
    component.description,
    component.category,
    ...component.tags,
  ].join('\n').toLocaleLowerCase();
  return (!normalizedQuery || searchable.includes(normalizedQuery))
    && tags.every((tag) => component.tags.includes(tag));
};

const LazyThumbnail = ({
  component,
  onPreviewPolicyChange,
}: {
  component: ComponentRecord;
  onPreviewPolicyChange: (policy: PreviewPolicy) => Promise<PreviewPolicy>;
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (visible || typeof IntersectionObserver === 'undefined' || !hostRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: '240px' });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={hostRef} className="gallery-card__preview">
      {visible
        ? (
          <PreviewHost
            component={component}
            onPreviewPolicyChange={onPreviewPolicyChange}
            loading="lazy"
            title={`Preview of ${component.name}`}
            compact
          />
        )
        : <span className="gallery-card__preview-loading">Preview queued</span>}
    </div>
  );
};

const GalleryCard = ({
  component,
  query,
  selected,
  checked,
  draggable,
  onOpen,
  onToggle,
  onDragStart,
  onDrop,
  onPreviewPolicyChange,
}: {
  component: ComponentRecord;
  query: string;
  selected: boolean;
  checked: boolean;
  draggable: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onPreviewPolicyChange: (policy: PreviewPolicy) => Promise<PreviewPolicy>;
}) => {
  const description = descriptionSnippet(component.description, query);

  return (
    <article
    className="gallery-card"
    data-component-id={component.id}
    data-selected={selected || undefined}
    aria-label={component.name}
    draggable={draggable}
    onDragStart={onDragStart}
    onDragOver={(event) => { if (draggable) event.preventDefault(); }}
    onDrop={onDrop}
  >
    <LazyThumbnail component={component} onPreviewPolicyChange={onPreviewPolicyChange} />
    <div className="gallery-card__body">
      <div className="gallery-card__heading">
        <button type="button" onClick={onOpen} aria-label={`Open ${component.name}`}>
          <Highlight text={component.name} query={query} />
        </button>
        <label>
          <span className="sr-only">Select {component.name}</span>
          <input
            type="checkbox"
            checked={checked}
            aria-label={`Select ${component.name}`}
            onChange={onToggle}
          />
        </label>
      </div>
      {component.category && (
        <span className="gallery-card__category">
          <Highlight text={component.category} query={query} />
        </span>
      )}
      {component.description && (
        <p
          className="gallery-card__description"
          data-contextual-match={String(description.contextual)}
          data-testid="gallery-description"
          aria-label={`Description: ${description.text}`}
        >
          <Highlight text={description.text} query={query} />
        </p>
      )}
      <div className="gallery-card__tags" aria-label={`${component.name} tags`}>
        {component.tags.map((tag) => (
          <span key={tag}><Highlight text={tag} query={query} /></span>
        ))}
      </div>
    </div>
    </article>
  );
};

export const GalleryView = ({ columns }: GalleryViewProps) => {
  const {
    settings,
    libraries,
    components,
    componentsLibraryId,
    selectedLibraryId,
    selectedComponentId,
    selectedComponentIds,
    searchQuery,
    selectedTags,
    loadComponents,
    setSelectedComponentId,
    toggleComponentSelection,
    clearComponentSelection,
    reorderComponents,
    updateComponentDraft,
    saveComponent,
    deleteComponent,
    updateLayout,
  } = useAppStore();
  const initialColumns = columns ?? settings.galleryColumns;
  const [galleryColumns, setGalleryColumns] = useState<GalleryColumns>(initialColumns);
  const [virtualStart, setVirtualStart] = useState(0);
  const [reorderError, setReorderError] = useState<{ libraryId: string; message: string } | null>(null);
  const draggedId = useRef<string | null>(null);
  const reorderRequestGeneration = useRef(0);
  const activeLibraryId = selectedLibraryId ?? libraries[0]?.id ?? null;

  useEffect(() => {
    if (columns === undefined) setGalleryColumns(settings.galleryColumns);
  }, [columns, settings.galleryColumns]);

  useEffect(() => {
    reorderRequestGeneration.current += 1;
    draggedId.current = null;
    setReorderError(null);
  }, [activeLibraryId]);

  useEffect(() => {
    if (!activeLibraryId || componentsLibraryId === activeLibraryId) return;
    void loadComponents(activeLibraryId).catch(() => undefined);
  }, [activeLibraryId, componentsLibraryId, loadComponents]);

  const filtered = useMemo(
    () => components.filter((component) => matchesFilters(component, searchQuery, selectedTags)),
    [components, searchQuery, selectedTags],
  );
  const isFiltered = Boolean(searchQuery.trim() || selectedTags.length);
  const isVirtualized = filtered.length > VIRTUALIZATION_THRESHOLD;
  const maxVirtualStart = Math.max(0, filtered.length - VIRTUAL_WINDOW_SIZE);
  const clampedVirtualStart = Math.min(virtualStart, maxVirtualStart);
  const rendered = isVirtualized
    ? filtered.slice(clampedVirtualStart, clampedVirtualStart + VIRTUAL_WINDOW_SIZE)
    : filtered;

  const changeColumns = (value: string) => {
    const next = Number(value) as GalleryColumns;
    if (![1, 2, 3, 4].includes(next)) return;
    setGalleryColumns(next);
    updateLayout({ galleryColumns: next });
  };

  const persistPreviewPolicy = useCallback(async (component: ComponentRecord, policy: PreviewPolicy) => {
    const next = { ...component, previewPolicy: policy };
    updateComponentDraft(next);
    const saved = await saveComponent(next);
    return saved.previewPolicy;
  }, [saveComponent, updateComponentDraft]);

  const dropComponent = useCallback(async (targetId: string) => {
    const sourceId = draggedId.current;
    draggedId.current = null;
    if (!activeLibraryId || isFiltered || !sourceId || sourceId === targetId) return;
    const ids = components.map((component) => component.id);
    const sourceIndex = ids.indexOf(sourceId);
    const targetIndex = ids.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    ids.splice(sourceIndex, 1);
    ids.splice(targetIndex, 0, sourceId);
    const requestGeneration = ++reorderRequestGeneration.current;
    setReorderError(null);
    try {
      await reorderComponents(activeLibraryId, ids);
      if (requestGeneration === reorderRequestGeneration.current) setReorderError(null);
    } catch {
      if (requestGeneration === reorderRequestGeneration.current) {
        setReorderError({
          libraryId: activeLibraryId,
          message: 'Could not reorder components. The previous order was restored.',
        });
      }
    }
  }, [activeLibraryId, components, isFiltered, reorderComponents]);

  const removeSelected = useCallback(async () => {
    const ids = [...selectedComponentIds];
    for (const id of ids) {
      try {
        await deleteComponent(id);
      } catch {
        // Keep failed items selected so the user can retry.
      }
    }
  }, [deleteComponent, selectedComponentIds]);

  const gridStyle = { '--gallery-columns': String(galleryColumns) } as CSSProperties;
  const beforeHeight = isVirtualized
    ? Math.floor(clampedVirtualStart / galleryColumns) * ESTIMATED_CARD_HEIGHT
    : 0;
  const remaining = Math.max(0, filtered.length - clampedVirtualStart - rendered.length);
  const afterHeight = isVirtualized
    ? Math.ceil(remaining / galleryColumns) * ESTIMATED_CARD_HEIGHT
    : 0;

  let content: ReactNode;
  if (filtered.length === 0) {
    content = (
      <div className="gallery-empty" role="status">
        <strong>No components match</strong>
        <span>Try a different search or clear a tag filter.</span>
      </div>
    );
  } else {
    content = (
      <div
        className="component-grid"
        data-testid="component-grid"
        data-virtualized={String(isVirtualized)}
        style={gridStyle}
        onScroll={isVirtualized ? (event) => {
          const row = Math.max(0, Math.floor(event.currentTarget.scrollTop / ESTIMATED_CARD_HEIGHT));
          setVirtualStart(Math.min(maxVirtualStart, row * galleryColumns));
        } : undefined}
      >
        {beforeHeight > 0 && <div className="virtual-spacer" style={{ height: beforeHeight }} />}
        {rendered.map((component) => (
          <GalleryCard
            key={component.id}
            component={component}
            query={searchQuery}
            selected={component.id === selectedComponentId}
            checked={selectedComponentIds.includes(component.id)}
            draggable={!isFiltered}
            onOpen={() => setSelectedComponentId(component.id)}
            onToggle={() => toggleComponentSelection(component.id)}
            onDragStart={(event) => {
              draggedId.current = component.id;
              event.dataTransfer?.setData('text/plain', component.id);
              if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
            }}
            onDrop={(event) => {
              event.preventDefault();
              void dropComponent(component.id);
            }}
            onPreviewPolicyChange={(policy) => persistPreviewPolicy(component, policy)}
          />
        ))}
        {afterHeight > 0 && <div className="virtual-spacer" style={{ height: afterHeight }} />}
      </div>
    );
  }

  return (
    <section className="gallery-view" aria-labelledby="gallery-heading">
      <header className="gallery-toolbar">
        <div>
          <span className="eyebrow">Gallery</span>
          <h2 id="gallery-heading">Component collection</h2>
          <span className="gallery-toolbar__count">{filtered.length} of {components.length}</span>
        </div>
        <label className="gallery-columns">
          <span>Columns</span>
          <select
            aria-label="Gallery columns"
            value={galleryColumns}
            onChange={(event) => changeColumns(event.target.value)}
          >
            {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </header>

      {selectedComponentIds.length > 0 && (
        <div className="gallery-selection" aria-label="Multi-select actions">
          <strong>{selectedComponentIds.length} selected</strong>
          <button type="button" className="button" onClick={clearComponentSelection}>Clear selection</button>
          <button type="button" className="button danger-action" onClick={() => void removeSelected()}>Delete selected</button>
        </div>
      )}
      {reorderError?.libraryId === activeLibraryId && (
        <div className="gallery-error" role="alert">{reorderError.message}</div>
      )}
      {content}
    </section>
  );
};

export default GalleryView;
