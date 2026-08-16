import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import type {
  ComponentDraft,
  ComponentRecord,
  ExportPayload,
  ImportResult,
  LibraryRecord,
} from '../../../../shared/contracts';
import { useAppStore } from '../../store/useAppStore';
import { t } from '../../i18n';

type ImportMode = 'files' | 'code';
type CandidateStatus = 'ready' | 'failed' | 'save-failed' | 'saving' | 'saved';

interface Candidate {
  id: string;
  path: string;
  fileName: string;
  size: number;
  status: CandidateStatus;
  draft?: ComponentDraft;
  message?: string;
}

interface ImportDialogProps {
  mode: ImportMode;
  libraries?: LibraryRecord[];
  selectedLibraryId?: string | null;
  onClose?: () => void;
  onSaved?: (components: ComponentRecord[]) => Promise<void> | void;
  onLibraryCreated?: (library: LibraryRecord) => void;
  onStartCode?: (libraryId: string) => void;
}

const LARGE_FILE_MESSAGE = 'File exceeds 5 MiB; confirm to import it';

const resolveFilePath = (file: File): string => {
  const apiPath = window.componentVault.getPathForFile?.(file);
  if (apiPath) return apiPath;
  return (file as File & { path?: string }).path ?? '';
};

const resultCandidates = (
  result: ImportResult,
  file: File,
  path: string,
  index: number,
): Candidate[] => {
  if (!result.ok) return [{
    id: `${path}:${index}`,
    path,
    fileName: result.fileName,
    size: file.size,
    status: 'failed',
    message: result.message,
  }];
  if ('bundle' in result) {
    return result.bundle.components.map((component, componentIndex) => ({
      id: `${path}:${index}:${componentIndex}`,
      path,
      fileName: `${result.fileName} / ${component.name}`,
      size: file.size,
      status: 'ready',
      draft: {
        ...component,
        tags: [...component.tags],
        previewPolicy: {
          ...component.previewPolicy,
          allowedOrigins: [...component.previewPolicy.allowedOrigins],
        },
        sourceType: 'import',
        originalFileName: result.fileName,
      },
    }));
  }
  return [{
    id: `${path}:${index}`,
    path,
    fileName: result.draft.originalFileName,
    size: file.size,
    status: 'ready',
    draft: result.draft,
  }];
};

const codeCharacters = (draft: ComponentDraft): number =>
  draft.html.length + draft.css.length + draft.javascript.length;

export const ImportDialog = ({
  mode,
  libraries = [],
  selectedLibraryId = null,
  onClose,
  onSaved,
  onLibraryCreated,
  onStartCode,
}: ImportDialogProps) => {
  const language = useAppStore((state) => state.settings.language);
  const [availableLibraries, setAvailableLibraries] = useState(libraries);
  const [libraryId, setLibraryId] = useState(
    selectedLibraryId && libraries.some((library) => library.id === selectedLibraryId)
      ? selectedLibraryId
      : libraries[0]?.id ?? '',
  );
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [libraryError, setLibraryError] = useState('');
  const [detectedBundle, setDetectedBundle] = useState<ExportPayload | null>(null);
  const [bundleDestination, setBundleDestination] = useState<'merge' | 'new'>('merge');
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => initialFocusRef.current?.focus(), []);

  const readyCandidates = useMemo(
    () => candidates.filter((candidate) =>
      (candidate.status === 'ready' || candidate.status === 'save-failed')
      && candidate.draft?.name.trim()),
    [candidates],
  );

  const importFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const resolved = files.map((file) => ({ file, path: resolveFilePath(file) }));
    const valid = resolved.filter((item) => item.path);
    const unresolved: Candidate[] = resolved
      .filter((item) => !item.path)
      .map(({ file }, index) => ({
        id: `unresolved:${file.name}:${index}`,
        path: '',
        fileName: file.name,
        size: file.size,
        status: 'failed',
        message: 'The selected file path could not be resolved.',
      }));

    setIsImporting(true);
    try {
      const results = valid.length > 0
        ? await window.componentVault.importHtmlFiles(valid.map((item) => item.path), undefined)
        : [];
      const imported = results.flatMap((result, index) => resultCandidates(
        result, valid[index].file, valid[index].path, index,
      ));
      const bundle = results.find((result): result is Extract<ImportResult, { bundle: ExportPayload }> =>
        result.ok && 'bundle' in result);
      if (bundle) {
        setDetectedBundle(bundle.bundle);
        setBundleDestination(availableLibraries.length > 0 ? 'merge' : 'new');
      }
      setCandidates((current) => [...current, ...imported, ...unresolved]);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [availableLibraries.length]);

  const retryLargeFile = useCallback(async (candidate: Candidate) => {
    setCandidates((current) => current.map((item) => item.id === candidate.id
      ? { ...item, status: 'saving', message: undefined }
      : item));
    const [result] = await window.componentVault.importHtmlFiles(
      [candidate.path],
      { allowLargeFiles: true },
    );
    if (result.ok && 'bundle' in result) {
      setDetectedBundle(result.bundle);
      setBundleDestination(availableLibraries.length > 0 ? 'merge' : 'new');
    }
    const replacements = resultCandidates(
      result,
      new File([], candidate.fileName),
      candidate.path,
      Number(candidate.id.split(':').at(-1) ?? 0),
    );
    setCandidates((current) => current.flatMap((item) => item.id === candidate.id ? replacements : [item]));
    setCandidates((current) => current.map((item) => item.path === candidate.path
      ? { ...item, size: candidate.size }
      : item));
  }, [availableLibraries.length]);

  const saveReady = useCallback(async () => {
    if ((!libraryId && bundleDestination !== 'new') || readyCandidates.length === 0) return;
    let targetLibraryId = libraryId;
    if (detectedBundle && bundleDestination === 'new') {
      try {
        const created = await window.componentVault.saveLibrary({
          name: detectedBundle.library.name,
          description: detectedBundle.library.description,
        });
        targetLibraryId = created.id;
        setAvailableLibraries((current) => [...current, created]);
        setLibraryId(created.id);
        setBundleDestination('merge');
        onLibraryCreated?.(created);
      } catch {
        setLibraryError('Could not create the exported library.');
        return;
      }
    }
    const saved: ComponentRecord[] = [];
    for (const candidate of readyCandidates) {
      setCandidates((current) => current.map((item) => item.id === candidate.id
        ? { ...item, status: 'saving', message: undefined }
        : item));
      try {
        const record = await window.componentVault.saveComponent({
          ...candidate.draft!,
          libraryId: targetLibraryId,
        });
        saved.push(record);
        setCandidates((current) => current.map((item) => item.id === candidate.id
          ? { ...item, status: 'saved' }
          : item));
      } catch {
        setCandidates((current) => current.map((item) => item.id === candidate.id
          ? { ...item, status: 'save-failed', message: 'Could not save this component.' }
          : item));
      }
    }
    if (saved.length > 0) await onSaved?.(saved);
  }, [bundleDestination, detectedBundle, libraryId, onLibraryCreated, onSaved, readyCandidates]);

  const createLibrary = useCallback(async () => {
    const name = newLibraryName.trim();
    if (!name) {
      setLibraryError('Enter a library name.');
      return;
    }
    try {
      const created = await window.componentVault.saveLibrary({ name, description: '' });
      setAvailableLibraries((current) => [...current, created]);
      setLibraryId(created.id);
      setNewLibraryName('');
      setLibraryError('');
      onLibraryCreated?.(created);
    } catch {
      setLibraryError('Could not create the library.');
    }
  }, [newLibraryName, onLibraryCreated]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => !element.hidden);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void importFiles(Array.from(event.dataTransfer.files));
  };

  const title = mode === 'files' ? t(language, 'importHtmlComponents') : t(language, 'createComponent');

  return (
    <div className="import-dialog-backdrop" onMouseDown={() => onClose?.()}>
      <div
        ref={dialogRef}
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="import-dialog__header">
          <div>
            <span className="eyebrow">{t(language, 'componentIntake')}</span>
            <h2 id="import-dialog-title">{title}</h2>
          </div>
          <button ref={initialFocusRef} type="button" className="button button--icon" aria-label="Close dialog" onClick={onClose}>×</button>
        </header>

        <div className="import-dialog__body">
          <section className="import-dialog__library" aria-labelledby="target-library-heading">
            <h3 id="target-library-heading">{t(language, 'targetLibrary')}</h3>
            {availableLibraries.length > 0 && (
              <label>
                <span>{t(language, 'library')}</span>
                <select aria-label={t(language, 'targetLibrary')} value={libraryId} onChange={(event) => setLibraryId(event.target.value)}>
                  {availableLibraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
                </select>
              </label>
            )}
            <div className="import-dialog__new-library">
              <label>
                <span>{availableLibraries.length > 0 ? t(language, 'orCreateLibrary') : t(language, 'createFirstLibrary')}</span>
                <input aria-label={t(language, 'newLibraryName')} value={newLibraryName} onChange={(event) => setNewLibraryName(event.target.value)} />
              </label>
              <button type="button" className="button" onClick={() => void createLibrary()}>{t(language, 'createLibrary')}</button>
            </div>
            {libraryError && <p className="field-error" role="alert">{libraryError}</p>}
          </section>

          {mode === 'files' && detectedBundle && (
            <fieldset className="import-dialog__bundle-choice">
              <legend>Component Vault library detected</legend>
              {availableLibraries.length > 0 && (
                <label>
                  <input
                    type="radio"
                    name="bundle-destination"
                    checked={bundleDestination === 'merge'}
                    onChange={() => setBundleDestination('merge')}
                  />
                  Merge into selected library
                </label>
              )}
              <label>
                <input
                  type="radio"
                  name="bundle-destination"
                  checked={bundleDestination === 'new'}
                  onChange={() => setBundleDestination('new')}
                />
                Create {detectedBundle.library.name} as a new library
              </label>
            </fieldset>
          )}

          {mode === 'files' ? (
            <>
              <div
                className="import-dropzone"
                role="group"
                aria-label={language === 'ja' ? t(language, 'dropHtmlFiles') : 'Drop HTML files'}
                onDragOver={(event) => event.preventDefault()}
                onDrop={dropFiles}
              >
                <strong>{t(language, 'dropHtmlFiles')}</strong>
                <span>or choose one or more .html / .htm files</span>
                <button type="button" className="button button--primary" disabled={isImporting} onClick={() => fileInputRef.current?.click()}>
                  {isImporting ? 'Reading files…' : 'Choose HTML files'}
                </button>
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  accept=".html,.htm,text/html"
                  multiple
                  aria-label="HTML files"
                  onChange={(event) => void importFiles(Array.from(event.target.files ?? []))}
                />
              </div>

              {candidates.length > 0 && (
                <section className="import-candidates" aria-labelledby="candidate-heading">
                  <div className="import-candidates__heading">
                    <h3 id="candidate-heading">{t(language, 'reviewCandidates')}</h3>
                    <span>{candidates.length} {t(language, 'files')}</span>
                  </div>
                  <ul>
                    {candidates.map((candidate) => (
                      <li key={candidate.id} className={`import-candidate import-candidate--${candidate.status === 'save-failed' ? 'failed' : candidate.status}`}>
                        <div className="import-candidate__identity">
                          <strong>{candidate.fileName}</strong>
                          <span>{candidate.draft ? `${codeCharacters(candidate.draft).toLocaleString()} characters` : `${candidate.size.toLocaleString()} bytes`}</span>
                        </div>
                        {candidate.draft && candidate.status !== 'saved' && (
                          <label>
                            <span>{t(language, 'componentName')}</span>
                            <input
                              aria-label={`Name for ${candidate.fileName}`}
                              value={candidate.draft.name}
                              onChange={(event) => setCandidates((current) => current.map((item) => item.id === candidate.id && item.draft
                                ? { ...item, draft: { ...item.draft, name: event.target.value } }
                                : item))}
                            />
                          </label>
                        )}
                        <span className="import-candidate__status">
                          {candidate.status === 'ready' && 'Ready'}
                          {candidate.status === 'saving' && 'Working…'}
                          {candidate.status === 'saved' && 'Added'}
                          {(candidate.status === 'failed' || candidate.status === 'save-failed') && 'Failed'}
                        </span>
                        {candidate.message && (
                          <div role={candidate.message === LARGE_FILE_MESSAGE ? 'alert' : 'status'} className="import-candidate__message">
                            <span>{candidate.fileName} — {candidate.size.toLocaleString()} bytes</span>
                            <span>{candidate.message}</span>
                            {candidate.message === LARGE_FILE_MESSAGE && candidate.path && (
                              <button type="button" className="button" onClick={() => void retryLargeFile(candidate)}>
                                Allow and retry {candidate.fileName}
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <section className="code-first-intro">
              <div className="code-first-intro__icon" aria-hidden="true">&lt;/&gt;</div>
              <div>
                <h3>{t(language, 'startEmptyCanvas')}</h3>
                <p>{t(language, 'codeFirstDescription')}</p>
              </div>
            </section>
          )}
        </div>

        <footer className="import-dialog__footer">
          <button type="button" className="button" onClick={onClose}>{t(language, 'cancel')}</button>
          {mode === 'files' ? (
            <button
              type="button"
              className="button button--primary"
              disabled={(!libraryId && bundleDestination !== 'new') || readyCandidates.length === 0}
              onClick={() => void saveReady()}
            >
              Add {readyCandidates.length} {readyCandidates.length === 1 ? 'component' : 'components'}
            </button>
          ) : (
            <button
              type="button"
              className="button button--primary"
              disabled={!libraryId}
              onClick={() => { if (libraryId) onStartCode?.(libraryId); }}
            >
              {t(language, 'startCoding')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};
