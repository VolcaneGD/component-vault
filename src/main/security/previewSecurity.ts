import {
  PREVIEW_REQUEST_BLOCKED_CHANNEL,
  type PreviewNetworkPolicyRequest,
} from '../../shared/contracts';

export interface PreviewFrame {
  frameTreeNodeId: number;
  url: string;
  parent: PreviewFrame | null;
  framesInSubtree: PreviewFrame[];
  detached?: boolean;
  isDestroyed?: () => boolean;
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
  frame?: PreviewFrame | null;
  preventDefault: () => void;
}

export interface PreviewWebContents {
  id: number;
  mainFrame: PreviewFrame;
  session: PreviewSession;
  on: (
    event: 'will-frame-navigate' | 'destroyed',
    listener: (details: FrameNavigationDetails) => void,
  ) => unknown;
  send?: (channel: string, event: unknown) => void;
}

interface WindowPreviewSecurity {
  documentUrl: URL;
  policies: Map<number, {
    allowedOrigins: Set<string>;
    previewId: string;
  }>;
  webContents: PreviewWebContents;
}

export interface PreviewSecurityController {
  attach: (webContents: PreviewWebContents, previewDocumentUrl: string) => void;
  configure: (webContentsId: number, request: PreviewNetworkPolicyRequest) => void;
  release: (webContentsId: number, previewId: string) => void;
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

const previewIdFromUrl = (value: string, documentUrl: URL): string | null => {
  try {
    const url = new URL(value);
    const previewId = url.hash.slice(1);
    return isPreviewDocument(url, documentUrl) && /^[A-Za-z0-9_-]+$/.test(previewId)
      ? previewId
      : null;
  } catch {
    return null;
  }
};

const isLiveFrame = (frame: PreviewFrame): boolean => (
  !frame.detached && !frame.isDestroyed?.()
);

const previewIdentityForFrame = (
  requestingFrame: PreviewFrame | null | undefined,
  documentUrl: URL,
): { frame: PreviewFrame; previewId: string } | null => {
  let frame = requestingFrame;
  const visited = new Set<number>();
  while (frame && !visited.has(frame.frameTreeNodeId)) {
    visited.add(frame.frameTreeNodeId);
    const previewId = previewIdFromUrl(frame.url, documentUrl);
    if (previewId && isLiveFrame(frame)) return { frame, previewId };
    frame = frame.parent;
  }
  return null;
};

export const createPreviewSecurityController = (
  options: PreviewSecurityOptions = {},
): PreviewSecurityController => {
  const windows = new Map<number, WindowPreviewSecurity>();
  const installedSessions = new WeakSet<PreviewSession>();

  const prunePolicies = (security: WindowPreviewSecurity): void => {
    const liveFrames = new Map(
      security.webContents.mainFrame.framesInSubtree
        .filter(isLiveFrame)
        .map((frame) => [frame.frameTreeNodeId, frame]),
    );
    for (const [frameTreeNodeId, policy] of security.policies) {
      const frame = liveFrames.get(frameTreeNodeId);
      if (!frame || previewIdFromUrl(frame.url, security.documentUrl) !== policy.previewId) {
        security.policies.delete(frameTreeNodeId);
      }
    }
  };

  const shouldCancel = (details: PreviewRequestDetails): boolean => {
    if (details.webContentsId === undefined) return false;
    const security = windows.get(details.webContentsId);
    if (!security) return false;
    prunePolicies(security);

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
    const identity = previewIdentityForFrame(details.frame, security.documentUrl);
    if (!identity) return true;
    if (isLocalPreviewAsset(requestUrl, security.documentUrl)) return false;
    if (requestUrl.protocol === 'blob:' || requestUrl.protocol === 'data:') return false;
    const policy = security.policies.get(identity.frame.frameTreeNodeId);
    return requestUrl.protocol !== 'https:'
      || policy?.previewId !== identity.previewId
      || !policy.allowedOrigins.has(requestUrl.origin);
  };

  return {
    attach: (webContents, previewDocumentUrl) => {
      const security: WindowPreviewSecurity = {
        documentUrl: new URL(previewDocumentUrl),
        policies: new Map(),
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
              const identity = security
                ? previewIdentityForFrame(details.frame, security.documentUrl)
                : null;
              if (security && identity && blockedUrl.protocol === 'https:') {
                security.webContents.send?.(PREVIEW_REQUEST_BLOCKED_CHANNEL, {
                  previewId: identity.previewId,
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
        const identity = previewIdentityForFrame(details.frame, security.documentUrl);
        if (identity) security.policies.delete(identity.frame.frameTreeNodeId);
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
            frame: details.frame,
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
      prunePolicies(security);
      const matches = security.webContents.mainFrame.framesInSubtree.filter((frame) => (
        isLiveFrame(frame)
        && frame.parent?.frameTreeNodeId === security.webContents.mainFrame.frameTreeNodeId
        && previewIdFromUrl(frame.url, security.documentUrl) === request.previewId
      ));
      if (matches.length !== 1) throw new Error('Preview frame is not available');
      security.policies.set(matches[0].frameTreeNodeId, {
        allowedOrigins: new Set(request.allowedOrigins),
        previewId: request.previewId,
      });
    },
    release: (webContentsId, previewId) => {
      if (!/^[A-Za-z0-9_-]+$/.test(previewId)) throw new Error('Invalid preview id');
      const security = windows.get(webContentsId);
      if (!security) return;
      for (const [frameTreeNodeId, policy] of security.policies) {
        if (policy.previewId === previewId) security.policies.delete(frameTreeNodeId);
      }
    },
  };
};
