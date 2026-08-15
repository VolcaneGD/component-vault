import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  ComponentRecord,
  ExportComponent,
  ExportCopyKind,
  ExportPayload,
  LibraryRecord,
} from '../../../../shared/contracts';
import { createCopyText, sanitizeDownloadFileName } from '../../../../shared/exportCode';

interface ExportDialogProps {
  library: LibraryRecord;
  components: ComponentRecord[];
  initiallySelectedIds?: string[];
  onClose?: () => void;
}

const exportComponent = (component: ComponentRecord): ExportComponent => ({
  name: component.name,
  description: component.description,
  category: component.category,
  tags: [...component.tags],
  html: component.html,
  css: component.css,
  javascript: component.javascript,
  previewPolicy: {
    ...component.previewPolicy,
    allowedOrigins: [...component.previewPolicy.allowedOrigins],
  },
});

export const ExportDialog = ({
  library,
  components,
  initiallySelectedIds,
  onClose,
}: ExportDialogProps) => {
  const initialIds = initiallySelectedIds?.length
    ? initiallySelectedIds.filter((id) => components.some((component) => component.id === id))
    : components.map((component) => component.id);
  const [includedIds, setIncludedIds] = useState(initialIds);
  const [activeId, setActiveId] = useState(initialIds[0] ?? components[0]?.id ?? '');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => closeRef.current?.focus(), []);

  const included = useMemo(
    () => components.filter((component) => includedIds.includes(component.id)),
    [components, includedIds],
  );
  const active = components.find((component) => component.id === activeId) ?? components[0];

  const createPayload = (): ExportPayload => ({
    format: 'component-vault',
    version: 1,
    library: { name: library.name, description: library.description },
    components: included.map(exportComponent),
  });

  const save = async () => {
    if (included.length === 0) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const result = await window.componentVault.saveStandaloneHtml(createPayload());
      if (result.ok) setStatus(`Saved to ${result.path}`);
      else if (!result.cancelled) setError(result.message);
    } catch {
      setError('Could not save the standalone HTML. Your selection is still available.');
    } finally {
      setSaving(false);
    }
  };

  const copy = async (kind: ExportCopyKind) => {
    if (!active) return;
    setError('');
    try {
      await window.componentVault.copyText(createCopyText(exportComponent(active), kind));
      setStatus('Copied to clipboard');
    } catch {
      setError('Could not copy to the clipboard.');
    }
  };

  const saveCss = async () => {
    if (!active) return;
    setError('');
    const result = await window.componentVault.saveCssFile(
      sanitizeDownloadFileName(active.name, '.css'),
      active.css,
    );
    if (result.ok) setStatus(`Saved to ${result.path}`);
    else if (!result.cancelled) setError(result.message);
  };

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
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

  return (
    <div className="import-dialog-backdrop" onMouseDown={() => onClose?.()}>
      <div
        ref={dialogRef}
        className="import-dialog export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <header className="import-dialog__header">
          <div><span className="eyebrow">Portable library</span><h2 id="export-dialog-title">Export standalone HTML</h2></div>
          <button ref={closeRef} type="button" className="button button--icon" aria-label="Close export dialog" onClick={onClose}>×</button>
        </header>
        <div className="import-dialog__body export-dialog__body">
          <section className="export-dialog__selection" aria-labelledby="export-components-heading">
            <div className="import-candidates__heading"><h3 id="export-components-heading">Components</h3><span>{included.length} selected</span></div>
            <ul>
              {components.map((component) => (
                <li key={component.id} className={active?.id === component.id ? 'is-active' : ''}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Include ${component.name}`}
                      checked={includedIds.includes(component.id)}
                      onChange={() => setIncludedIds((current) => current.includes(component.id)
                        ? current.filter((id) => id !== component.id)
                        : [...current, component.id])}
                    />
                    <button type="button" onClick={() => setActiveId(component.id)}>{component.name}</button>
                  </label>
                </li>
              ))}
            </ul>
          </section>
          <section className="export-dialog__copy" aria-labelledby="copy-code-heading">
            <h3 id="copy-code-heading">Copy or save {active?.name ?? 'component'}</h3>
            <div className="export-dialog__copy-grid">
              <button type="button" className="button" onClick={() => void copy('html')}>Copy HTML</button>
              <button type="button" className="button" onClick={() => void copy('css')}>Copy CSS</button>
              <button type="button" className="button" onClick={() => void copy('javascript')}>Copy JavaScript</button>
              <button type="button" className="button" onClick={() => void copy('css-linked-html')}>Copy CSS-linked HTML</button>
              <button type="button" className="button" onClick={() => void copy('full-code')}>Copy full code</button>
              <button type="button" className="button" onClick={() => void saveCss()}>Save CSS file</button>
            </div>
            <p>JavaScript is included only by Copy JavaScript and Copy full code.</p>
          </section>
          {status && <p className="export-dialog__status" role="status">{status}</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
        <footer className="import-dialog__footer">
          <button type="button" className="button" onClick={onClose}>Cancel</button>
          <button type="button" className="button button--primary" disabled={saving || included.length === 0} onClick={() => void save()}>
            {saving ? 'Preparing export…' : 'Save standalone HTML'}
          </button>
        </footer>
      </div>
    </div>
  );
};
