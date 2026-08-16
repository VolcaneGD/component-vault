import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { t } from '../../i18n';

interface UndoToastProps {
  label: string;
  expiresAt: number;
  onUndo: () => Promise<unknown> | unknown;
  onExpire: () => Promise<unknown> | unknown;
}

export const UndoToast = ({ label, expiresAt, onUndo, onExpire }: UndoToastProps) => {
  const language = useAppStore((state) => state.settings.language);
  const [isBusy, setIsBusy] = useState(false);
  const settledRef = useRef(false);
  const expiryReachedRef = useRef(false);

  useEffect(() => {
    const delay = Math.max(0, expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      expiryReachedRef.current = true;
      if (settledRef.current) return;
      settledRef.current = true;
      setIsBusy(true);
      void Promise.resolve(onExpire())
        .catch(() => undefined)
        .finally(() => setIsBusy(false));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [expiresAt, onExpire]);

  const undo = async () => {
    if (settledRef.current) return;
    settledRef.current = true;
    setIsBusy(true);
    try {
      await onUndo();
    } catch {
      settledRef.current = false;
      if (expiryReachedRef.current || Date.now() >= expiresAt) {
        settledRef.current = true;
        await Promise.resolve(onExpire()).catch(() => undefined);
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <div>
        <strong>{t(language, 'componentDeleted')}</strong>
        <span>{label}</span>
      </div>
      <button
        type="button"
        disabled={isBusy}
        aria-label={language === 'ja' ? `${t(language, 'undoDelete')}: ${label}` : `${t(language, 'undoDelete')} ${label}`}
        onClick={() => void undo()}
      >
        {t(language, 'undo')}
      </button>
    </div>
  );
};
