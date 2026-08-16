import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '../../i18n';
import type { AppLanguage } from '../../../../shared/contracts';

export type QuickCreateKind = 'library' | 'tag';

interface QuickCreateDialogProps {
  kind: QuickCreateKind;
  language: AppLanguage;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

export const QuickCreateDialog = ({ kind, language, onClose, onSubmit }: QuickCreateDialogProps) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isLibrary = kind === 'library';
  const fieldLabel = t(language, isLibrary ? 'libraryName' : 'tagName');
  const submitLabel = t(language, isLibrary ? 'createLibrary' : 'addTag');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) {
      setError(t(language, 'nameRequired'));
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      await onSubmit(value);
      onClose();
    } catch {
      setError(t(language, 'commandFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="quick-create-dialog" aria-label={submitLabel} onSubmit={(event) => void submit(event)}>
        <header>
          <h2>{submitLabel}</h2>
          <button type="button" className="button button--icon" aria-label={t(language, 'closeDialog')} onClick={onClose}>×</button>
        </header>
        <label>
          <span>{fieldLabel}</span>
          <input
            ref={inputRef}
            aria-label={fieldLabel}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && <p className="quick-create-dialog__error" role="alert">{error}</p>}
        <footer>
          <button type="button" className="button" onClick={onClose}>{t(language, 'cancel')}</button>
          <button type="submit" className="button button--primary" disabled={isSaving}>{submitLabel}</button>
        </footer>
      </form>
    </div>
  );
};
