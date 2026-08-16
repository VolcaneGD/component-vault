import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ComponentRecord,
  ComponentSaveInput,
  PreviewPolicy,
} from '../../../../shared/contracts';
import { EditorTabs, type EditorLanguage } from './EditorTabs';
import { useAppStore } from '../../store/useAppStore';
import { t } from '../../i18n';

type SaveState = 'draft' | 'saved' | 'saving' | 'failed';

interface ComponentEditorProps {
  component: ComponentRecord;
  onChange?: (component: ComponentRecord) => void;
  onSave?: (component: ComponentSaveInput) => Promise<ComponentRecord>;
  onDuplicate?: (component: ComponentRecord) => Promise<unknown> | unknown;
  onDelete?: (componentId: string) => Promise<unknown> | unknown;
  isNew?: boolean;
  autoFocusHtml?: boolean;
  draftOriginId?: string;
  onDraftRekeyed?: (componentId: string, draftOriginId: string) => void;
}

const toSaveInput = (component: ComponentRecord): ComponentSaveInput => ({
  id: component.id,
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

const uniqueTokens = (value: string): string[] => Array.from(new Set(
  value.split(/[,\n]/).map((token) => token.trim()).filter(Boolean),
));

const hasPersistableCode = (component: ComponentRecord): boolean =>
  Boolean(component.html.trim() || component.css.trim() || component.javascript.trim());

const canPersistNewDraft = (component: ComponentRecord): boolean =>
  Boolean(component.name.trim()) && hasPersistableCode(component);

export const ComponentEditor = ({
  component,
  onChange,
  onSave,
  onDuplicate,
  onDelete,
  isNew = false,
  autoFocusHtml = false,
  draftOriginId,
  onDraftRekeyed,
}: ComponentEditorProps) => {
  const language = useAppStore((state) => state.settings.language);
  const saveLabels: Record<SaveState, string> = {
    draft: t(language, 'notSaved'), saved: t(language, 'saved'), saving: t(language, 'saving'), failed: t(language, 'saveFailed'),
  };
  const [draft, setDraft] = useState(component);
  const [tagText, setTagText] = useState(component.tags.join(', '));
  const [saveState, setSaveState] = useState<SaveState>(isNew ? 'draft' : 'saved');
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const draftRef = useRef(component);
  const componentIdRef = useRef(component.id);
  const incomingPolicyRef = useRef(JSON.stringify(component.previewPolicy));
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const flushDirtySnapshot = () => {
    if (!dirtyRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    dirtyRef.current = false;
    const snapshot = draftRef.current;
    if (isNew && !canPersistNewDraft(snapshot)) return;
    const save = onSaveRef.current
      ?? ((input: ComponentSaveInput) => window.componentVault.saveComponent(input));
    void save(toSaveInput(snapshot)).catch(() => undefined);
  };

  useEffect(() => {
    const incomingPolicy = JSON.stringify(component.previewPolicy);
    if (componentIdRef.current === component.id) {
      if (draftOriginId !== undefined) {
        onDraftRekeyed?.(component.id, draftOriginId);
      }
      if (incomingPolicyRef.current === incomingPolicy) return;
      incomingPolicyRef.current = incomingPolicy;
      const merged = { ...draftRef.current, previewPolicy: component.previewPolicy };
      draftRef.current = merged;
      setDraft(merged);
      return;
    }
    if (draftOriginId !== undefined && draftOriginId === componentIdRef.current) {
      componentIdRef.current = component.id;
      incomingPolicyRef.current = incomingPolicy;
      const rekeyed = {
        ...draftRef.current,
        id: component.id,
        createdAt: component.createdAt,
        updatedAt: component.updatedAt,
        deletedAt: component.deletedAt,
        previewPolicy: component.previewPolicy,
      };
      draftRef.current = rekeyed;
      setDraft(rekeyed);
      setSaveState(dirtyRef.current ? 'saving' : 'saved');
      onDraftRekeyed?.(component.id, draftOriginId);
      return;
    }
    flushDirtySnapshot();
    componentIdRef.current = component.id;
    incomingPolicyRef.current = incomingPolicy;
    draftRef.current = component;
    revisionRef.current = 0;
    dirtyRef.current = false;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setDraft(component);
    setTagText(component.tags.join(', '));
    setSaveState(isNew ? 'draft' : 'saved');
  }, [component, draftOriginId, onDraftRekeyed]);

  useEffect(() => () => flushDirtySnapshot(), []);

  const persistDraft = useCallback(async (force = false) => {
    if (!dirtyRef.current && !force) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const snapshot = draftRef.current;
    if (isNew && !canPersistNewDraft(snapshot)) {
      dirtyRef.current = true;
      setSaveState('draft');
      return;
    }
    const revision = revisionRef.current;
    setSaveState('saving');

    try {
      const save = onSaveRef.current ?? ((input: ComponentSaveInput) => window.componentVault.saveComponent(input));
      const saved = await save(toSaveInput(snapshot));
      if (componentIdRef.current !== snapshot.id) return;
      onChangeRef.current?.(saved);
      if (revisionRef.current === revision) {
        draftRef.current = saved;
        dirtyRef.current = false;
        setDraft(saved);
        setTagText(saved.tags.join(', '));
        setSaveState('saved');
      }
    } catch {
      if (componentIdRef.current === snapshot.id) {
        dirtyRef.current = true;
        setSaveState('failed');
      }
    }
  }, [isNew]);

  const scheduleAutosave = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void persistDraft(), 500);
  }, [persistDraft]);

  const updateDraft = useCallback((update: (current: ComponentRecord) => ComponentRecord) => {
    const next = update(draftRef.current);
    draftRef.current = next;
    revisionRef.current += 1;
    dirtyRef.current = true;
    setDraft(next);
    onChangeRef.current?.(next);
    if (isNew && !canPersistNewDraft(next)) {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      setSaveState('draft');
    } else {
      setSaveState('saving');
      scheduleAutosave();
    }
  }, [isNew, scheduleAutosave]);

  const updatePolicy = useCallback((patch: Partial<PreviewPolicy>) => {
    updateDraft((current) => ({
      ...current,
      previewPolicy: { ...current.previewPolicy, ...patch },
    }));
  }, [updateDraft]);

  const updateCode = useCallback((language: EditorLanguage, value: string) => {
    updateDraft((current) => ({ ...current, [language]: value }));
  }, [updateDraft]);

  const duplicate = useCallback(async () => {
    setIsActionsOpen(false);
    if (onDuplicate) {
      await onDuplicate(draftRef.current);
      return;
    }
    const input = toSaveInput(draftRef.current);
    await window.componentVault.saveComponent({ ...input, id: undefined, name: `${input.name} copy` });
  }, [onDuplicate]);

  const remove = useCallback(async () => {
    setIsActionsOpen(false);
    if (onDelete) await onDelete(component.id);
    else await window.componentVault.deleteComponent(component.id);
  }, [component.id, onDelete]);

  return (
    <section
      className="component-editor"
      aria-label={t(language, 'componentEditor')}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void persistDraft(true);
        }
      }}
    >
      <header className="component-editor__header">
        <div className="component-editor__title-group">
          <label>
            <span className="sr-only">{t(language, 'componentName')}</span>
            <input
              className="component-editor__name component-editor__name-input"
              aria-label={t(language, 'componentName')}
              value={draft.name}
              onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <span className={`save-status save-status--${saveState}`} role="status" aria-live="polite">
            {saveLabels[saveState]}
          </span>
        </div>
        <div className="component-editor__actions">
          <button type="button" className="button button--primary" onClick={() => void persistDraft(true)}>
            {t(language, 'save')}
          </button>
          <div className="component-editor__action-menu">
            <button
              type="button"
              className="button button--icon"
              aria-label={t(language, 'componentActions')}
              aria-expanded={isActionsOpen}
              onClick={() => setIsActionsOpen((open) => !open)}
            >
              ···
            </button>
            {isActionsOpen && (
              <div className="component-editor__menu" role="menu">
                <button type="button" role="menuitem" onClick={() => void duplicate()}>{t(language, 'duplicate')}</button>
                <button type="button" role="menuitem" className="danger-action" onClick={() => void remove()}>{t(language, 'delete')}</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {isNew && (!draft.name.trim() || !hasPersistableCode(draft)) && (
        <div className="component-editor__validation" role="status" aria-live="polite">
          {!draft.name.trim() && <span>{t(language, 'nameRequired')}</span>}
          {!hasPersistableCode(draft) && <span>{t(language, 'codeRequired')}</span>}
        </div>
      )}

      <details className="component-editor__metadata">
        <summary>{t(language, 'detailsPermissions')}</summary>
        <div className="metadata-grid">
          <label className="metadata-field metadata-field--wide">
            <span>{t(language, 'description')}</span>
            <textarea
              aria-label={t(language, 'description')}
              value={draft.description}
              onChange={(event) => updateDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <label className="metadata-field">
            <span>{t(language, 'category')}</span>
            <input
              aria-label={t(language, 'category')}
              value={draft.category}
              onChange={(event) => updateDraft((current) => ({ ...current, category: event.target.value }))}
            />
          </label>
          <label className="metadata-field">
            <span>{t(language, 'tagInput')}</span>
            <input
              aria-label={t(language, 'tagInput')}
              value={tagText}
              placeholder="button, primary"
              onChange={(event) => {
                const value = event.target.value;
                setTagText(value);
                const tags = uniqueTokens(value);
                updateDraft((current) => ({ ...current, tags }));
              }}
            />
          </label>
          <fieldset className="metadata-field metadata-field--permissions">
            <legend>{t(language, 'previewPermissions')}</legend>
            <label><input type="checkbox" checked={draft.previewPolicy.allowScripts} onChange={(event) => updatePolicy({ allowScripts: event.target.checked })} /> {t(language, 'scripts')}</label>
            <label><input type="checkbox" checked={draft.previewPolicy.allowForms} onChange={(event) => updatePolicy({ allowForms: event.target.checked })} /> {t(language, 'forms')}</label>
            <label><input type="checkbox" checked={draft.previewPolicy.allowPopups} onChange={(event) => updatePolicy({ allowPopups: event.target.checked })} /> {t(language, 'popups')}</label>
            <label><input aria-label={t(language, 'allowExternalNetwork')} type="checkbox" checked={draft.previewPolicy.externalNetworkEnabled ?? false} onChange={(event) => updatePolicy({ externalNetworkEnabled: event.target.checked })} /> {t(language, 'externalNetwork')}</label>
          </fieldset>
          <label className="metadata-field metadata-field--wide">
            <span>{t(language, 'allowedHttpsOrigins')}</span>
            <textarea
              aria-label={t(language, 'allowedHttpsOrigins')}
              placeholder="https://cdn.example.com"
              value={draft.previewPolicy.allowedOrigins.join('\n')}
              disabled={!draft.previewPolicy.externalNetworkEnabled}
              onChange={(event) => updatePolicy({ allowedOrigins: uniqueTokens(event.target.value) })}
            />
          </label>
        </div>
      </details>

      <EditorTabs
        componentId={draft.id}
        html={draft.html}
        css={draft.css}
        javascript={draft.javascript}
        onChange={updateCode}
        onSave={() => void persistDraft(true)}
        autoFocusHtml={autoFocusHtml}
      />
    </section>
  );
};
