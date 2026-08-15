import {
  PREVIEW_REQUEST_BLOCKED_CHANNEL,
  type PreviewNetworkPolicyRequest,
} from '../../shared/contracts';

interface PreviewFrame {
  parent: unknown | null;
}

interface PreviewRequestDetails {
  webContentsId?: number;
  url: string;
  resourceType: string;
  frame?: PreviewFrame | null;
}

interface PreviewSecurityOptions {
  onBlockedRequest?: (details: PreviewRequestDetails) => void;
}

interface PreviewWebRequest {
  onBeforeRequest: (
    filter: { urls: string[] },
    listener: (
      details: PreviewRequestDetails,
      callback: (response: { cancel?: boolean }) => void,
    ) => void,
  ) => void;
}

interface PreviewSession {
  webRequest: PreviewWebRequest;
}

interface FrameNavigationDetails {
  url: string;
  isMainFrame: boolean;
  preventDefault: () => void;
}

export interface PreviewWebContents {
  id: number;
  session: PreviewSession;
  on: (
    event: 'will-frame-navigate' | 'destroyed',
    listener: (details: FrameNavigationDetails) => void,
  ) => unknown;
  send?: (channel: string, event: unknown) => void;
}

interface WindowPreviewSecurity {
  documentUrl: URL;
  allowedOrigins: Set<string>;
  previewId: string | null;
  webContents: PreviewWebContents;
}

export interface PreviewSecurityController {
  attach: (webContents: PreviewWebContents, previewDocumentUrl: string) => void;
  configure: (webContentsId: number, request: PreviewNetworkPolicyRequest) => void;
}

const isCanonicalHttpsOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
};

const isPreviewDocument = (requestUrl: URL, documentUrl: URL): boolean => (
  requestUrl.protocol === documentUrl.protocol
  && requestUrl.host === documentUrl.host
  && requestUrl.pathname === documentUrl.pathname
);

const isLocalPreviewAsset = (requestUrl: URL, documentUrl: URL): boolean => {
  const previewDirectory = documentUrl.pathname.slice(0, documentUrl.pathname.lastIndexOf('/') + 1);
  return requestUrl.protocol === documentUrl.protocol
    && requestUrl.host === documentUrl.host
    && requestUrl.pathname.startsWith(previewDirectory);
};

export const createPreviewSecurityController = (
  options: PreviewSecurityOptions = {},
): PreviewSecurityController => {
  const windows = new Map<number, WindowPreviewSecurity>();
  const installedSessions = new WeakSet<PreviewSession>();

  const shouldCancel = (details: PreviewRequestDetails): boolean => {
    if (details.webContentsId === undefined) return false;
    const security = windows.get(details.webContentsId);
    if (!security) return false;

    const isSubframe = details.resourceType === 'subFrame' || Boolean(details.frame?.parent);
    if (!isSubframe) return false;

    let requestUrl: URL;
    try {
      requestUrl = new URL(details.url);
    } catch {
      return true;
    }

    if (details.resourceType === 'subFrame') {
      return !isPreviewDocument(requestUrl, security.documentUrl);
    }
    if (isLocalPreviewAsset(requestUrl, security.documentUrl)) return false;
    if (requestUrl.protocol === 'blob:' || requestUrl.protocol === 'data:') return false;
    return requestUrl.protocol !== 'https:' || !security.allowedOrigins.has(requestUrl.origin);
  };

  return {
    attach: (webContents, previewDocumentUrl) => {
      const security: WindowPreviewSecurity = {
        documentUrl: new URL(previewDocumentUrl),
        allowedOrigins: new Set(),
        previewId: null,
        webContents,
      };
      windows.set(webContents.id, security);

      if (!installedSessions.has(webContents.session)) {
        installedSessions.add(webContents.session);
        webContents.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
          const cancel = shouldCancel(details);
          if (cancel) options.onBlockedRequest?.(details);
          if (cancel && details.resourceType !== 'subFrame') {
            const security = details.webContentsId === undefined
              ? undefined
              : windows.get(details.webContentsId);
            try {
              const blockedUrl = new URL(details.url);
              if (security?.previewId && blockedUrl.protocol === 'https:') {
                security.webContents.send?.(PREVIEW_REQUEST_BLOCKED_CHANNEL, {
                  previewId: security.previewId,
                  url: details.url,
                  origin: blockedUrl.origin,
                });
              }
            } catch {}
          }
          callback(cancel ? { cancel: true } : {});
        });
      }

      webContents.on('will-frame-navigate', (details) => {
        if (details.isMainFrame) return;
        let nextUrl: URL;
        try {
          nextUrl = new URL(details.url);
        } catch {
          details.preventDefault();
          return;
        }
        if (!isPreviewDocument(nextUrl, security.documentUrl)) {
          options.onBlockedRequest?.({
            webContentsId: webContents.id,
            url: details.url,
            resourceType: 'subFrame',
            frame: { parent: {} },
          });
          details.preventDefault();
        }
      });
      webContents.on('destroyed', () => {
        windows.delete(webContents.id);
      });
    },
    configure: (webContentsId, request) => {
      if (!/^[A-Za-z0-9_-]+$/.test(request.previewId)
        || !Array.isArray(request.allowedOrigins)
        || request.allowedOrigins.length > 64
        || !request.allowedOrigins.every(isCanonicalHttpsOrigin)) {
        throw new Error('Invalid preview network policy');
      }
      const security = windows.get(webContentsId);
      if (!security) throw new Error('Preview security is not attached');
      security.allowedOrigins = new Set(request.allowedOrigins);
      security.previewId = request.previewId;
    },
  };
};
