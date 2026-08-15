export interface PreviewError {
  type: 'runtime' | 'unhandled-rejection' | 'csp' | 'bootstrap';
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

const errorTypeLabel: Record<PreviewError['type'], string> = {
  runtime: 'Runtime',
  'unhandled-rejection': 'Promise rejection',
  csp: 'Content Security Policy',
  bootstrap: 'Preview bootstrap',
};

const errorLocation = (error: PreviewError): string | null => {
  if (error.line === undefined) return null;
  if (error.column === undefined) return `Line ${error.line}`;
  return `Line ${error.line}, column ${error.column}`;
};

export const ErrorConsole = ({
  errors,
  onClear,
  onReload,
  onAllowOrigin,
}: ErrorConsoleProps) => (
  <section className="error-console" aria-label="Preview error console">
    <header className="error-console__header">
      <h2>Error console</h2>
      <div className="error-console__actions">
        <button type="button" onClick={onReload}>Reload preview</button>
        <button type="button" onClick={onClear} disabled={errors.length === 0}>
          Clear errors
        </button>
      </div>
    </header>

    {errors.length === 0 ? (
      <p className="error-console__empty">No preview errors.</p>
    ) : (
      <ol className="error-console__list" aria-live="polite">
        {errors.map((error, index) => {
          const location = errorLocation(error);
          return (
            <li className="error-console__entry" key={`${error.type}-${index}`}>
              <strong>{errorTypeLabel[error.type]}</strong>
              <p>{error.message}</p>
              {location && <p>{location}</p>}
              {error.blockedUri && <p>Blocked resource: {error.blockedUri}</p>}
              {error.stack && <pre>{error.stack}</pre>}
              {error.blockedOrigin && onAllowOrigin && (
                <div className="error-console__guidance">
                  <p>External access is blocked until this HTTPS origin is allowed.</p>
                  <button type="button" onClick={() => onAllowOrigin(error.blockedOrigin!)}>
                    Allow {error.blockedOrigin}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    )}
  </section>
);
