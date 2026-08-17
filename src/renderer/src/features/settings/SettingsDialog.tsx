import { useEffect, useRef } from 'react';
import type { AppLanguage } from '../../../../shared/contracts';
import { t } from '../../i18n';
import { UpdatePanel } from './UpdatePanel';

interface SettingsDialogProps {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}

export const SettingsDialog = ({ language, onLanguageChange, onClose, returnFocus }: SettingsDialogProps) => {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    return () => returnFocus?.focus();
  }, [returnFocus]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="about-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
        <header>
          <div>
            <span className="eyebrow">{t(language, 'preferences')}</span>
            <h2 id="settings-dialog-title">{t(language, 'settings')}</h2>
          </div>
          <button ref={closeRef} type="button" className="button button--icon" aria-label={t(language, 'closeSettings')} onClick={onClose}>×</button>
        </header>
        <div className="about-dialog__body">
          <fieldset className="settings-language" aria-describedby="settings-language-description">
            <legend>{t(language, 'language')}</legend>
            <p id="settings-language-description">{t(language, 'languageDescription')}</p>
            <label><input type="radio" name="app-language" checked={language === 'ja'} onChange={() => onLanguageChange('ja')} /> {t(language, 'japanese')}</label>
            <label><input type="radio" name="app-language" checked={language === 'en'} onChange={() => onLanguageChange('en')} /> {t(language, 'english')}</label>
          </fieldset>
          <UpdatePanel language={language} />
        </div>
      </section>
    </div>
  );
};
