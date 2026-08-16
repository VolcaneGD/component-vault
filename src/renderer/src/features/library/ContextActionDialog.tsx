import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppLanguage } from '../../../../shared/contracts';
import { t } from '../../i18n';

interface RenameDialogProps {
  language: AppLanguage;
  initialName: string;
  target: 'library' | 'component';
  onClose: () => void;
  onConfirm: (name: string) => Promise<void>;
}

export const RenameDialog = ({ language, initialName, target, onClose, onConfirm }: RenameDialogProps) => {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const title = t(language, target === 'library' ? 'renameLibrary' : 'renameComponent');

  useEffect(() => inputRef.current?.select(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) {
      setError(t(language, 'nameRequired'));
      return;
    }
    setIsSaving(true);
    try {
      await onConfirm(value);
      onClose();
    } catch {
      setError(t(language, 'commandFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="quick-create-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={(event) => void submit(event)}>
        <header><h2>{title}</h2><button type="button" className="button button--icon" aria-label={t(language, 'closeDialog')} onClick={onClose}>×</button></header>
        <label><span>{t(language, 'newName')}</span><input ref={inputRef} aria-label={t(language, 'newName')} value={name} onChange={(event) => setName(event.target.value)} /></label>
        {error && <p className="quick-create-dialog__error" role="alert">{error}</p>}
        <footer><button type="button" className="button" onClick={onClose}>{t(language, 'cancel')}</button><button type="submit" className="button button--primary" disabled={isSaving}>{t(language, 'rename')}</button></footer>
      </form>
    </div>
  );
};

interface DeleteLibraryDialogProps {
  language: AppLanguage;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export const DeleteLibraryDialog = ({ language, onClose, onConfirm }: DeleteLibraryDialogProps) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      setError(t(language, 'commandFailed'));
    } finally {
      setIsDeleting(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="quick-create-dialog" role="dialog" aria-modal="true" aria-label={t(language, 'deleteLibrary')}>
        <header><h2>{t(language, 'deleteLibrary')}</h2><button type="button" className="button button--icon" aria-label={t(language, 'closeDialog')} onClick={onClose}>×</button></header>
        <p>{t(language, 'confirmDeleteLibrary')}</p>
        <p className="quick-create-dialog__error">{t(language, 'deleteLibraryWarning')}</p>
        {error && <p className="quick-create-dialog__error" role="alert">{error}</p>}
        <footer><button type="button" className="button" onClick={onClose}>{t(language, 'cancel')}</button><button type="button" className="button danger-action" disabled={isDeleting} onClick={() => void confirm()}>{t(language, 'deleteLibrary')}</button></footer>
      </section>
    </div>
  );
};
