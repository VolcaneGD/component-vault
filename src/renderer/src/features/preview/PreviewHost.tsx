import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRecord, PreviewPolicy } from '../../../../shared/contracts';
import { ErrorConsole, type PreviewError } from '../feedback/ErrorConsole';
import { buildPreviewDocument, PREVIEW_CHANNEL } from './buildPreviewDocument';

interface PreviewHostProps {
  component: ComponentRecord;
  onPreviewPolicyChange?: (policy: PreviewPolicy) => void;
}

interface PreviewMessage {
  channel: typeof PREVIEW_CHANNEL;
  previewId: string;
  error: PreviewError;
}

const createPreviewId = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const isOptionalNumber = (value: unknown): value is number | undefined => (
  value === undefined || (typeof value === 'number' && Number.isFinite(value))
);

const isOptionalString = (value: unknown): value is string | undefined => (
  value === undefined || typeof value === 'string'
);

const isPreviewError = (value: unknown): value is PreviewError => {
  if (typeof value !== 'object' || value === null) return false;

  const error = value as Record<string, unknown>;
  return (
    ['runtime', 'unhandled-rejection', 'csp', 'bootstrap'].includes(String(error.type))
    && typeof error.message === 'string'
    && isOptionalNumber(error.line)
    && isOptionalNumber(error.column)
    && isOptionalString(error.stack)
    && isOptionalString(error.blockedUri)
    && isOptionalString(error.blockedOrigin)
    && isOptionalString(error.directive)
  );
};

const isPreviewMessage = (value: unknown): value is PreviewMessage => {
  if (typeof value !== 'object' || value === null) return false;

  const message = value as Record<string, unknown>;
  return message.channel === PREVIEW_CHANNEL
    && typeof message.previewId === 'string'
    && isPreviewError(message.error);
};

const isCanonicalHttpsOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
};

export const PreviewHost = ({ component, onPreviewPolicyChange }: PreviewHostProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewId, setPreviewId] = useState(createPreviewId);
  const [errors, setErrors] = useState<PreviewError[]>([]);
  const [previewPolicy, setPreviewPolicy] = useState(component.previewPolicy);

  useEffect(() => {
    setPreviewPolicy(component.previewPolicy);
    setErrors([]);
    setPreviewId(createPreviewId());
  }, [component.id, component.updatedAt, component.previewPolicy]);

  const previewComponent = useMemo(() => ({
    ...component,
    previewPolicy,
  }), [component, previewPolicy]);
  const srcDoc = useMemo(
    () => buildPreviewDocument(previewComponent, previewId),
    [previewComponent, previewId],
  );

  useEffect(() => {
    const receivePreviewMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isPreviewMessage(event.data) || event.data.previewId !== previewId) return;

      const { error } = event.data;
      setErrors((current) => [...current, error]);
    };

    window.addEventListener('message', receivePreviewMessage);
    return () => window.removeEventListener('message', receivePreviewMessage);
  }, [previewId]);

  const reload = useCallback(() => {
    setErrors([]);
    setPreviewId(createPreviewId());
  }, []);

  const allowOrigin = useCallback((origin: string) => {
    if (!isCanonicalHttpsOrigin(origin) || previewPolicy.allowedOrigins.includes(origin)) return;

    const nextPolicy: PreviewPolicy = {
      ...previewPolicy,
      externalNetworkEnabled: true,
      allowedOrigins: [...previewPolicy.allowedOrigins, origin],
    };
    setPreviewPolicy(nextPolicy);
    setErrors([]);
    setPreviewId(createPreviewId());
    onPreviewPolicyChange?.(nextPolicy);
  }, [onPreviewPolicyChange, previewPolicy]);

  return (
    <section className="preview-host" aria-label="Live component preview">
      <iframe
        ref={iframeRef}
        className="preview-host__frame"
        title="Component preview"
        sandbox="allow-scripts allow-forms allow-modals"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
      />
      <ErrorConsole
        errors={errors}
        onClear={() => setErrors([])}
        onReload={reload}
        onAllowOrigin={allowOrigin}
      />
    </section>
  );
};
