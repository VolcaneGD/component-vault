import { describe, expect, it, vi } from 'vitest';
import { createPreviewSecurityController } from '../../src/main/security/previewSecurity';

type RequestListener = (
  details: {
    webContentsId?: number;
    url: string;
    resourceType: string;
    frame?: { parent: unknown | null } | null;
  },
  callback: (response: { cancel?: boolean }) => void,
) => void;

describe('preview request security', () => {
  it('allows the local preview bootstrap and exact opted-in HTTPS resources only', () => {
    let beforeRequest: RequestListener | undefined;
    const webContents = {
      id: 42,
      session: {
        webRequest: {
          onBeforeRequest: vi.fn((_filter, listener) => { beforeRequest = listener; }),
        },
      },
      on: vi.fn(),
    };
    const security = createPreviewSecurityController();
    security.attach(webContents, 'file:///app/renderer/preview/preview.html');
    security.configure(42, {
      previewId: 'preview-id',
      allowedOrigins: ['https://cdn.example.test'],
    });

    const decision = (url: string, resourceType: string, isSubframe = true) => {
      const callback = vi.fn();
      beforeRequest?.({
        webContentsId: 42,
        url,
        resourceType,
        frame: isSubframe ? { parent: {} } : { parent: null },
      }, callback);
      return callback.mock.calls[0]?.[0];
    };

    expect(decision('file:///app/renderer/preview/preview.html', 'subFrame')).toEqual({});
    expect(decision('file:///app/renderer/preview/preview-bootstrap.js', 'script')).toEqual({});
    expect(decision('https://cdn.example.test/theme.css', 'stylesheet')).toEqual({});
    expect(decision('https://other.example.test/theme.css', 'stylesheet')).toEqual({ cancel: true });
    expect(decision('https://cdn.example.test/escape', 'subFrame')).toEqual({ cancel: true });
    expect(decision('https://other.example.test/app-data', 'xhr', false)).toEqual({});
  });

  it('rejects noncanonical policy origins before they can reach request filtering', () => {
    const security = createPreviewSecurityController();

    expect(() => security.configure(42, {
      previewId: 'preview-id',
      allowedOrigins: ['https://cdn.example.test/path'],
    })).toThrow('Invalid preview network policy');
  });

  it('reports a canceled request at the pre-request boundary', () => {
    let beforeRequest: RequestListener | undefined;
    const onBlockedRequest = vi.fn();
    const security = createPreviewSecurityController({ onBlockedRequest });
    security.attach({
      id: 7,
      session: { webRequest: { onBeforeRequest: (_filter, listener) => { beforeRequest = listener; } } },
      on: vi.fn(),
    }, 'file:///app/preview/preview.html');
    const details = {
      webContentsId: 7,
      url: 'https://blocked.example.test/navigation',
      resourceType: 'subFrame',
      frame: { parent: {} },
    };

    beforeRequest?.(details, vi.fn());

    expect(onBlockedRequest).toHaveBeenCalledWith(details);
  });

  it('reports a denied HTTPS subresource to the renderer with the active preview ID', () => {
    let beforeRequest: RequestListener | undefined;
    const send = vi.fn();
    const security = createPreviewSecurityController();
    security.attach({
      id: 9,
      session: { webRequest: { onBeforeRequest: (_filter, listener) => { beforeRequest = listener; } } },
      on: vi.fn(),
      send,
    }, 'component-vault-preview://sandbox/preview.html');
    security.configure(9, { previewId: 'active-id', allowedOrigins: [] });

    beforeRequest?.({
      webContentsId: 9,
      url: 'https://images.example.test/photo.png',
      resourceType: 'image',
      frame: { parent: {} },
    }, vi.fn());

    expect(send).toHaveBeenCalledWith('preview:request-blocked', {
      previewId: 'active-id',
      url: 'https://images.example.test/photo.png',
      origin: 'https://images.example.test',
    });
  });
});
