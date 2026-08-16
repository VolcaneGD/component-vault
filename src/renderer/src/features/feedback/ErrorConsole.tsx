import { useAppStore } from '../../store/useAppStore';
import { t } from '../../i18n';

export interface PreviewError {
  type: 'runtime' | 'unhandled-rejection' | 'csp' | 'bootstrap' | 'policy';
  message: string;
  line?: number;
  column?: number;
  stack?: string;
  blockedUri?: string;
  blockedOrigin?: string;
  directive?: string;
}

interface ErrorConsoleProps {
  errors: PreviewError[];
  onClear: () => void;
  onReload: () => void;
  onAllowOrigin?: (origin: string) => void;
}

const errorLocation = (error: PreviewError, language: ReturnType<typeof useAppStore.getState>['settings']['language']): string | null => {
  if (error.line === undefined) return null;
  if (error.column === undefined) return `${t(language, 'line')} ${error.line}`;
  return `${t(language, 'line')} ${error.line}, ${t(language, 'column')} ${error.column}`;
};

export const ErrorConsole = ({
  errors,
  onClear,
  onReload,
  onAllowOrigin,
}: ErrorConsoleProps) => {
  const language = useAppStore((state) => state.settings.language);
  const errorTypeLabel: Record<PreviewError['type'], string> = {
    runtime: t(language, 'runtime'), 'unhandled-rejection': t(language, 'promiseRejection'),
    csp: t(language, 'contentSecurityPolicy'), bootstrap: t(language, 'previewBootstrap'), policy: t(language, 'previewPolicy'),
  };
  return <section className="error-console" aria-label={t(language, 'previewErrorConsole')}>
    <header className="error-console__header">
      <h2>{t(language, 'errorConsole')}</h2>
      <div className="error-console__actions">
        <button type="button" onClick={onReload}>{t(language, 'reloadPreview')}</button>
        <button type="button" onClick={onClear} disabled={errors.length === 0}>
          {t(language, 'clearErrors')}
        </button>
      </div>
    </header>

    {errors.length === 0 ? (
      <p className="error-console__empty">{t(language, 'noPreviewErrors')}</p>
    ) : (
      <ol className="error-console__list" aria-live="polite">
        {errors.map((error, index) => {
          const location = errorLocation(error, language);
          return (
            <li className="error-console__entry" key={`${error.type}-${index}`}>
              <strong>{errorTypeLabel[error.type]}</strong>
              <p>{error.message}</p>
              {location && <p>{location}</p>}
              {error.blockedUri && <p>{t(language, 'blockedResource')}: {error.blockedUri}</p>}
              {error.stack && <pre>{error.stack}</pre>}
              {error.blockedOrigin && onAllowOrigin && (
                <div className="error-console__guidance">
                  <p>{t(language, 'externalBlocked')}</p>
                  <button type="button" onClick={() => onAllowOrigin(error.blockedOrigin!)}>
                    {t(language, 'allow')} {error.blockedOrigin}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    )}
  </section>;
};
