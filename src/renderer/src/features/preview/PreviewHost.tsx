import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isPreviewPolicy,
  type ComponentRecord,
  type PreviewPolicy,
} from '../../../../shared/contracts';
import { ErrorConsole, type PreviewError } from '../feedback/ErrorConsole';
import { useAppStore } from '../../store/useAppStore';
import { t } from '../../i18n';
import {
  isPreviewReadyMessage,
  MAX_PREVIEW_ERRORS,
  MAX_PREVIEW_ERRORS_PER_SECOND,
  normalizePreviewError,
  PREVIEW_EVENT_CHANNEL,
  previewPayload,
  previewPolicyKey,
} from './previewProtocol';

interface PreviewHostProps {
  component: ComponentRecord;
  onPreviewPolicyChange?: (policy: PreviewPolicy) => Promise<PreviewPolicy>;
  loading?: 'eager' | 'lazy';
  title?: string;
  compact?: boolean;
}

interface AuthoritativePolicy {
  componentId: string;
  basePolicyKey: string;
  policy: PreviewPolicy;
}

interface ComponentErrors {
  componentId: string;
  items: PreviewError[];
}

const createPreviewId = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const isCanonicalHttpsOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
};

const policyFailure = (error: unknown, language: 'ja' | 'en'): PreviewError => ({
  type: 'policy',
  message: `${t(language, 'previewPolicySaveFailed')}: ${error instanceof Error ? error.message : String(error)}`,
});

export const PreviewHost = ({
  component,
  onPreviewPolicyChange,
  loading = 'eager',
  title,
  compact = false,
}: PreviewHostProps) => {
  const language = useAppStore((state) => state.settings.language);
  const previewTheme = useAppStore((state) => state.settings.previewTheme);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rateWindow = useRef<number[]>([]);
  const currentComponent = useRef({ id: component.id, policyKey: previewPolicyKey(component.previewPolicy) });
  const [reloadRevision, setReloadRevision] = useState(0);
  const [authoritativePolicy, setAuthoritativePolicy] = useState<AuthoritativePolicy | null>(null);
  const [componentErrors, setComponentErrors] = useState<ComponentErrors>({
    componentId: component.id,
    items: [],
  });

  const basePolicyKey = previewPolicyKey(component.previewPolicy);
  currentComponent.current = { id: component.id, policyKey: basePolicyKey };
  const effectivePolicy = authoritativePolicy?.componentId === component.id
    && authoritativePolicy.basePolicyKey === basePolicyKey
    ? authoritativePolicy.policy
    : component.previewPolicy;
  const effectivePolicyKey = previewPolicyKey(effectivePolicy);
  const previewId = useMemo(
    createPreviewId,
    [
      component.id,
      component.updatedAt,
      component.html,
      component.css,
      component.javascript,
      basePolicyKey,
      effectivePolicyKey,
      reloadRevision,
    ],
  );
  const frameSource = useMemo(() => {
    return `component-vault-preview://sandbox/preview.html#${previewId}`;
  }, [previewId]);
  const errors = componentErrors.componentId === component.id ? componentErrors.items : [];

  const appendError = useCallback((error: PreviewError) => {
    setComponentErrors((current) => {
      const items = current.componentId === component.id ? current.items : [];
      return {
        componentId: component.id,
        items: [...items, error].slice(-MAX_PREVIEW_ERRORS),
      };
    });
  }, [component.id]);

  const acceptPreviewError = useCallback((error: PreviewError) => {
    const now = Date.now();
    rateWindow.current = rateWindow.current.filter((timestamp) => now - timestamp < 1_000);
    if (rateWindow.current.length >= MAX_PREVIEW_ERRORS_PER_SECOND) return;
    rateWindow.current.push(now);
    appendError(error);
  }, [appendError]);

  const activatePreview = useCallback(async () => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) return;
    const expectedId = previewId;
    try {
      await window.componentVault?.configurePreviewNetwork?.({
        previewId,
        allowedOrigins: effectivePolicy.externalNetworkEnabled
          ? effectivePolicy.allowedOrigins
          : [],
      });
      if (iframeRef.current?.contentWindow !== frameWindow || expectedId !== previewId) return;
      frameWindow.postMessage({
        ...previewPayload(component, effectivePolicy),
        previewId,
      }, '*');
    } catch (error) {
      appendError({
        type: 'bootstrap',
        message: `${t(language, 'previewSecuritySetupFailed')}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [appendError, component, effectivePolicy, previewId]);

  const receivePreviewMessage = useCallback((event: MessageEvent<unknown>) => {
    if (event.source !== iframeRef.current?.contentWindow) return;
    if (isPreviewReadyMessage(event.data)) {
      if (event.data.previewId === previewId) void activatePreview();
      return;
    }
    if (typeof event.data !== 'object' || event.data === null) return;
    const message = event.data as Record<string, unknown>;
    if (message.channel !== PREVIEW_EVENT_CHANNEL || message.previewId !== previewId) return;
    const error = normalizePreviewError(message.error);
    if (!error) return;

    acceptPreviewError(error);
  }, [acceptPreviewError, activatePreview, previewId]);

  const messageListenerRef = useRef(receivePreviewMessage);
  messageListenerRef.current = receivePreviewMessage;
  useEffect(() => {
    const listener = (event: MessageEvent<unknown>) => messageListenerRef.current(event);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  useEffect(() => window.componentVault?.onPreviewRequestBlocked?.((event) => {
    if (event.previewId !== previewId) return;
    const error = normalizePreviewError({
      type: 'csp',
      message: t(language, 'blockedExternalPreviewResource'),
      blockedUri: event.url,
      blockedOrigin: event.origin,
      directive: 'main-process-request-policy',
    });
    if (error) acceptPreviewError(error);
  }), [acceptPreviewError, previewId]);

  useEffect(() => () => {
    const release = window.componentVault?.releasePreviewNetwork?.(previewId);
    void release?.catch(() => undefined);
  }, [previewId]);

  const reload = useCallback(() => {
    rateWindow.current = [];
    setComponentErrors({ componentId: component.id, items: [] });
    setReloadRevision((revision) => revision + 1);
  }, [component.id]);

  const allowOrigin = useCallback(async (origin: string) => {
    if (!onPreviewPolicyChange
      || !isCanonicalHttpsOrigin(origin)
      || effectivePolicy.allowedOrigins.includes(origin)) return;

    const request: PreviewPolicy = {
      ...effectivePolicy,
      externalNetworkEnabled: true,
      allowedOrigins: [...effectivePolicy.allowedOrigins, origin],
    };
    const requestContext = { ...currentComponent.current };
    try {
      const savedPolicy = await onPreviewPolicyChange(request);
      if (!isPreviewPolicy(savedPolicy)) throw new Error(t(language, 'persistenceInvalidPolicy'));
      if (currentComponent.current.id !== requestContext.id
        || currentComponent.current.policyKey !== requestContext.policyKey) return;
      setAuthoritativePolicy({
        componentId: requestContext.id,
        basePolicyKey: requestContext.policyKey,
        policy: savedPolicy,
      });
      rateWindow.current = [];
      setComponentErrors({ componentId: component.id, items: [] });
    } catch (error) {
      appendError(policyFailure(error, language));
    }
  }, [appendError, component.id, effectivePolicy, language, onPreviewPolicyChange]);

  return (
    <section
      className={`preview-host${compact ? ' preview-host--compact' : ''}`}
      aria-label={compact ? undefined : t(language, 'liveComponentPreview')}
    >
      <iframe
        key={previewId}
        ref={iframeRef}
        className="preview-host__frame"
        data-preview-theme={previewTheme}
        title={title ?? t(language, 'componentPreview')}
        loading={loading}
        sandbox="allow-scripts allow-forms allow-modals"
        referrerPolicy="no-referrer"
        src={frameSource}
      />
      <ErrorConsole
        errors={errors}
        onClear={() => setComponentErrors({ componentId: component.id, items: [] })}
        onReload={reload}
        onAllowOrigin={onPreviewPolicyChange ? allowOrigin : undefined}
      />
    </section>
  );
};
