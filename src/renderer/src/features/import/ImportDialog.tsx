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
  ImportResult,
  LibraryRecord,
} from '../../../../shared/contracts';

type ImportMode = 'files' | 'code';
type CandidateStatus = 'ready' | 'failed' | 'saving' | 'saved';

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
  onSaved?: (components: ComponentRecord[]) => void;
  onLibraryCreated?: (library: LibraryRecord) => void;
  onStartCode?: (libraryId: string) => void;
}

const LARGE_FILE_MESSAGE = 'File exceeds 5 MiB; confirm to import it';

const resolveFilePath = (file: File): string => {
  const apiPath = window.componentVault.getPathForFile?.(file);
  if (apiPath) return apiPath;
  return (file as File & { path?: string }).path ?? '';
};

const resultCandidate = (
  result: ImportResult,
  file: File,
  path: string,
  index: number,
): Candidate => result.ok
  ? {
    id: `${path}:${index}`,
    path,
    fileName: result.draft.originalFileName,
    size: file.size,
    status: 'ready',
    draft: result.draft,
  }
  : {
    id: `${path}:${index}`,
    path,
    fileName: result.fileName,
    size: file.size,
    status: 'failed',
    message: result.message,
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => initialFocusRef.current?.focus(), []);

  const readyCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.status === 'ready' && candidate.draft?.name.trim()),
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
      const imported = results.map((result, index) => resultCandidate(
        result,
        valid[index].file,
        valid[index].path,
        index,
      ));
      setCandidates((current) => [...current, ...imported, ...unresolved]);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const retryLargeFile = useCallback(async (candidate: Candidate) => {
    setCandidates((current) => current.map((item) => item.id === candidate.id
      ? { ...item, status: 'saving', message: undefined }
      : item));
    const [result] = await window.componentVault.importHtmlFiles(
      [candidate.path],
      { allowLargeFiles: true },
    );
    setCandidates((current) => current.map((item) => item.id === candidate.id
      ? resultCandidate(
        result,
        new File([], candidate.fileName),
        candidate.path,
        Number(candidate.id.split(':').at(-1) ?? 0),
      )
      : item));
    setCandidates((current) => current.map((item) => item.path === candidate.path
      ? { ...item, size: candidate.size }
      : item));
  }, []);

  const saveReady = useCallback(async () => {
    if (!libraryId || readyCandidates.length === 0) return;
    const saved: ComponentRecord[] = [];
    for (const candidate of readyCandidates) {
      setCandidates((current) => current.map((item) => item.id === candidate.id
        ? { ...item, status: 'saving', message: undefined }
        : item));
      try {
        const record = await window.componentVault.saveComponent({
          ...candidate.draft!,
          libraryId,
        });
        saved.push(record);
        setCandidates((current) => current.map((item) => item.id === candidate.id
          ? { ...item, status: 'saved' }
          : item));
      } catch {
        setCandidates((current) => current.map((item) => item.id === candidate.id
          ? { ...item, status: 'failed', message: 'Could not save this component.' }
          : item));
      }
    }
    if (saved.length > 0) onSaved?.(saved);
  }, [libraryId, onSaved, readyCandidates]);

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

  const title = mode === 'files' ? 'Import HTML components' : 'Create a component';

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
            <span className="eyebrow">Component intake</span>
            <h2 id="import-dialog-title">{title}</h2>
          </div>
          <button ref={initialFocusRef} type="button" className="button button--icon" aria-label="Close dialog" onClick={onClose}>×</button>
        </header>

        <div className="import-dialog__body">
          <section className="import-dialog__library" aria-labelledby="target-library-heading">
            <h3 id="target-library-heading">Target library</h3>
            {availableLibraries.length > 0 && (
              <label>
                <span>Library</span>
                <select aria-label="Target library" value={libraryId} onChange={(event) => setLibraryId(event.target.value)}>
                  {availableLibraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
                </select>
              </label>
            )}
            <div className="import-dialog__new-library">
              <label>
                <span>{availableLibraries.length > 0 ? 'Or create a library' : 'Create your first library'}</span>
                <input aria-label="New library name" value={newLibraryName} onChange={(event) => setNewLibraryName(event.target.value)} />
              </label>
              <button type="button" className="button" onClick={() => void createLibrary()}>Create library</button>
            </div>
            {libraryError && <p className="field-error" role="alert">{libraryError}</p>}
          </section>

          {mode === 'files' ? (
            <>
              <div
                className="import-dropzone"
                role="group"
                aria-label="Drop HTML files"
                onDragOver={(event) => event.preventDefault()}
                onDrop={dropFiles}
              >
                <strong>Drop HTML files here</strong>
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
                    <h3 id="candidate-heading">Review candidates</h3>
                    <span>{candidates.length} files</span>
                  </div>
                  <ul>
                    {candidates.map((candidate) => (
                      <li key={candidate.id} className={`import-candidate import-candidate--${candidate.status}`}>
                        <div className="import-candidate__identity">
                          <strong>{candidate.fileName}</strong>
                          <span>{candidate.draft ? `${codeCharacters(candidate.draft).toLocaleString()} characters` : `${candidate.size.toLocaleString()} bytes`}</span>
                        </div>
                        {candidate.draft && candidate.status !== 'saved' && (
                          <label>
                            <span>Name</span>
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
                          {candidate.status === 'failed' && 'Failed'}
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
                <h3>Start with an empty code canvas</h3>
                <p>The HTML editor opens first. Your preview stays live, and nothing is saved until you add a name and some HTML, CSS, or JavaScript.</p>
              </div>
            </section>
          )}
        </div>

        <footer className="import-dialog__footer">
          <button type="button" className="button" onClick={onClose}>Cancel</button>
          {mode === 'files' ? (
            <button
              type="button"
              className="button button--primary"
              disabled={!libraryId || readyCandidates.length === 0}
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
              Start coding
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};
