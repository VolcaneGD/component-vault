import { useEffect, useRef, useState } from 'react';
import notices from '../../../../../resources/THIRD_PARTY_NOTICES.md?raw';

interface AboutDialogProps {
  onClose: () => void;
}

const PROPERTY_HTML_SOURCE = 'https://github.com/uni928/PropertyHTML';

export const AboutDialog = ({ onClose }: AboutDialogProps) => {
  const [appVersion, setAppVersion] = useState('Loading...');
  const [electronVersion, setElectronVersion] = useState('Loading...');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const api = window.componentVault;
    if (!api) return;
    void Promise.all([
      api.getAppVersion().catch(() => 'Unavailable'),
      api.getElectronVersion().catch(() => 'Unavailable'),
    ]).then(([application, electron]) => {
      setAppVersion(application);
      setElectronVersion(electron);
    });
  }, []);

  return (
    <div className="about-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
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
