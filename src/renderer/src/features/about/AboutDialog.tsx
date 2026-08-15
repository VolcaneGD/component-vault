import { useEffect, useRef, useState } from 'react';
import notices from '../../../../../resources/THIRD_PARTY_NOTICES.md?raw';

interface AboutDialogProps {
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}

const PROPERTY_HTML_SOURCE = 'https://github.com/uni928/PropertyHTML';

export const AboutDialog = ({ onClose, returnFocus }: AboutDialogProps) => {
  const [appVersion, setAppVersion] = useState('Loading...');
  const [electronVersion, setElectronVersion] = useState('Loading...');
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const api = window.componentVault;
    if (api) {
      void Promise.all([
        api.getAppVersion().catch(() => 'Unavailable'),
        api.getElectronVersion().catch(() => 'Unavailable'),
      ]).then(([application, electron]) => {
        setAppVersion(application);
        setElectronVersion(electron);
      });
    }
    return () => returnFocus?.focus();
  }, [returnFocus]);

  return (
    <div className="about-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
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
        }}
      >
        <header>
          <div>
            <span className="eyebrow">Application information</span>
            <h2 id="about-dialog-title">About Component Vault</h2>
          </div>
          <button ref={closeRef} type="button" className="button button--icon" aria-label="Close About" onClick={onClose}>x</button>
        </header>
        <div className="about-dialog__body">
          <div className="about-dialog__identity" aria-hidden="true">CV</div>
          <dl>
            <div><dt>Component Vault</dt><dd>Version {appVersion}</dd></div>
            <div><dt>Runtime</dt><dd>Electron {electronVersion}</dd></div>
          </dl>
          <p>
            Inspired by PropertyHTML. Copyright (c) 2026 uni928.
          </p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void window.componentVault.openExternal(PROPERTY_HTML_SOURCE)}
          >
            Open PropertyHTML source
          </button>
          <details className="about-dialog__notices">
            <summary>Third-Party Notices and MIT License</summary>
            <pre>{notices}</pre>
          </details>
        </div>
      </section>
    </div>
  );
};
