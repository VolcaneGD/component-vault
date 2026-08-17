(() => {
  'use strict';

  const INIT_CHANNEL = 'component-vault:preview:init';
  const READY_CHANNEL = 'component-vault:preview:ready';
  const EVENT_CHANNEL = 'component-vault:preview:event';
  const MAX_MESSAGE_LENGTH = 2_000;
  const MAX_STACK_LENGTH = 8_000;
  const MAX_RESOURCE_LENGTH = 2_048;
  const previewId = location.hash.slice(1);
  const objectUrls = [];

  if (!/^[A-Za-z0-9_-]+$/.test(previewId)) return;

  const bounded = (value, maximum) => {
    let result;
    if (typeof value === 'string') {
      result = value;
    } else {
      try {
        const serialized = JSON.stringify(value);
        result = serialized === undefined ? String(value) : serialized;
      } catch {
        try { result = String(value); } catch { result = 'Unserializable value'; }
      }
    }
    return result.length <= maximum ? result : `${result.slice(0, maximum - 1)}…`;
  };

  const optionalNumber = (value) => Number.isFinite(value) && value > 0 ? value : undefined;
  const sendError = (error) => parent.postMessage({
    channel: EVENT_CHANNEL,
    previewId,
    error: {
      type: error.type,
      message: bounded(error.message, MAX_MESSAGE_LENGTH),
      line: optionalNumber(error.line),
      column: optionalNumber(error.column),
      stack: error.stack === undefined ? undefined : bounded(error.stack, MAX_STACK_LENGTH),
      blockedUri: error.blockedUri === undefined
        ? undefined
        : bounded(error.blockedUri, MAX_RESOURCE_LENGTH),
      blockedOrigin: error.blockedOrigin,
      directive: error.directive === undefined
        ? undefined
        : bounded(error.directive, MAX_MESSAGE_LENGTH),
    },
  }, '*');

  window.addEventListener('error', (event) => {
    sendError({
      type: 'runtime',
      message: event.message || event.error,
      line: event.lineno,
      column: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
      blockedUri: event.filename || undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    sendError({
      type: 'unhandled-rejection',
      message: event.reason instanceof Error ? event.reason.message : event.reason,
      stack: event.reason instanceof Error ? event.reason.stack : undefined,
    });
  });

  document.addEventListener('securitypolicyviolation', (event) => {
    let blockedOrigin;
    try {
      const blockedUrl = new URL(event.blockedURI);
      if (blockedUrl.protocol === 'https:') blockedOrigin = blockedUrl.origin;
    } catch {}

    sendError({
      type: 'csp',
      message: `Blocked by Content Security Policy: ${event.effectiveDirective}`,
      line: event.lineNumber,
      column: event.columnNumber,
      blockedUri: event.blockedURI || undefined,
      blockedOrigin,
      directive: event.effectiveDirective || undefined,
    });
  });

  const clearObjectUrls = () => {
    for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
  };

  const objectUrl = (contents, type) => {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    objectUrls.push(url);
    return url;
  };

  const isComponentPayload = (value) => value
    && typeof value === 'object'
    && typeof value.html === 'string'
    && typeof value.css === 'string'
    && typeof value.javascript === 'string'
    && typeof value.allowScripts === 'boolean';

  const applyCanvasTheme = (previewTheme) => {
    const dark = previewTheme === 'dark';
    const background = dark ? '#121826' : '#ffffff';
    document.documentElement.style.backgroundColor = background;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.body.style.minHeight = '100vh';
    document.body.style.margin = '0';
    document.body.style.backgroundColor = background;
    document.body.style.color = dark ? '#edf1ff' : '#111827';
  };

  window.addEventListener('message', (event) => {
    if (event.source !== parent) return;
    if (!event.data || event.data.channel !== INIT_CHANNEL || event.data.previewId !== previewId) return;
    if (!isComponentPayload(event.data.component)) return;

    try {
      clearObjectUrls();
      document.querySelectorAll('[data-component-vault-preview-asset]').forEach((element) => element.remove());
      const root = document.querySelector('#component-vault-preview-root');
      if (!root) throw new Error('Preview root is unavailable');
      applyCanvasTheme(event.data.component.previewTheme === 'dark' ? 'dark' : 'light');
      root.innerHTML = event.data.component.html;

      if (event.data.component.css) {
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.dataset.componentVaultPreviewAsset = 'true';
        stylesheet.href = objectUrl(event.data.component.css, 'text/css');
        document.head.append(stylesheet);
      }

      if (event.data.component.allowScripts && event.data.component.javascript) {
        const script = document.createElement('script');
        script.dataset.componentVaultPreviewAsset = 'true';
        script.src = objectUrl(event.data.component.javascript, 'text/javascript');
        document.body.append(script);
      }
    } catch (error) {
      sendError({
        type: 'bootstrap',
        message: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  window.addEventListener('unload', clearObjectUrls, { once: true });
  parent.postMessage({ channel: READY_CHANNEL, previewId }, '*');
})();
