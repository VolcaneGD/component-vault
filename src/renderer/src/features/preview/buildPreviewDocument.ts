import type { ComponentRecord } from '../../../../shared/contracts';

const PREVIEW_CHANNEL = 'component-vault:preview';
const SAFE_NONCE = /^[A-Za-z0-9_-]+$/;

const canonicalHttpsOrigins = (component: ComponentRecord): string[] => {
  if (!component.previewPolicy.externalNetworkEnabled) return [];

  return [...new Set(component.previewPolicy.allowedOrigins.filter((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.origin === value;
    } catch {
      return false;
    }
  }))];
};

const serializeForInlineScript = (value: unknown): string => JSON.stringify(value)
  .replaceAll('<', '\\u003c')
  .replaceAll('>', '\\u003e')
  .replaceAll('&', '\\u0026')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029');

const buildCsp = (nonce: string, origins: string[]): string => {
  const networkSources = origins.length > 0 ? ` ${origins.join(' ')}` : '';

  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'${networkSources}`,
    `style-src 'nonce-${nonce}'${networkSources}`,
    `img-src data: blob:${networkSources}`,
    `font-src${networkSources || " 'none'"}`,
    `media-src blob:${networkSources}`,
    `connect-src${networkSources || " 'none'"}`,
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "navigate-to 'none'",
  ].join('; ');
};

export const buildPreviewDocument = (component: ComponentRecord, nonce: string): string => {
  if (!SAFE_NONCE.test(nonce)) {
    throw new Error('Preview nonce must use base64url-safe characters');
  }

  const origins = canonicalHttpsOrigins(component);
  const csp = buildCsp(nonce, origins);
  const payload = serializeForInlineScript({
    html: component.html,
    css: component.css,
    javascript: component.previewPolicy.allowScripts ? component.javascript : '',
  });
  const previewId = serializeForInlineScript(nonce);
  const channel = serializeForInlineScript(PREVIEW_CHANNEL);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Component preview</title>
</head>
<body>
  <div id="component-vault-preview-root"></div>
  <script nonce="${nonce}">
    (() => {
      'use strict';
      const previewId = ${previewId};
      const channel = ${channel};
      const component = ${payload};
      const send = (error) => parent.postMessage({ channel, previewId, error }, '*');
      const asMessage = (value) => {
        if (value instanceof Error) return value.message;
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch { return String(value); }
      };
      const asStack = (value) => value instanceof Error && typeof value.stack === 'string'
        ? value.stack
        : undefined;

      window.addEventListener('error', (event) => {
        send({
          type: 'runtime',
          message: event.message || asMessage(event.error),
          line: event.lineno || undefined,
          column: event.colno || undefined,
          stack: asStack(event.error),
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        send({
          type: 'unhandled-rejection',
          message: asMessage(event.reason),
          stack: asStack(event.reason),
        });
      });

      document.addEventListener('securitypolicyviolation', (event) => {
        let blockedOrigin;
        try {
          const blockedUrl = new URL(event.blockedURI);
          const secureProtocol = ['https', ':'].join('');
          if (blockedUrl.protocol === secureProtocol) blockedOrigin = blockedUrl.origin;
        } catch {}

        send({
          type: 'csp',
          message: 'Blocked by Content Security Policy: ' + event.effectiveDirective,
          line: event.lineNumber || undefined,
          column: event.columnNumber || undefined,
          blockedUri: event.blockedURI || undefined,
          blockedOrigin,
          directive: event.effectiveDirective || undefined,
        });
      });

      try {
        const root = document.querySelector('#component-vault-preview-root');
        if (!root) throw new Error('Preview root is unavailable');

        const style = document.createElement('style');
        style.setAttribute('nonce', previewId);
        style.textContent = component.css;
        document.head.append(style);
        root.innerHTML = component.html;

        if (component.javascript) {
          const script = document.createElement('script');
          script.setAttribute('nonce', previewId);
          script.textContent = component.javascript;
          document.body.append(script);
        }
      } catch (error) {
        send({ type: 'bootstrap', message: asMessage(error), stack: asStack(error) });
      }
    })();
  </script>
</body>
</html>`;
};

export { PREVIEW_CHANNEL };
