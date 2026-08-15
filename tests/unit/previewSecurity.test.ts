import { describe, expect, it, vi } from 'vitest';
import { createPreviewSecurityController } from '../../src/main/security/previewSecurity';

type RequestListener = (
  details: {
    webContentsId?: number;
    url: string;
    resourceType: string;
    frame?: TestFrame | null;
  },
  callback: (response: { cancel?: boolean }) => void,
) => void;

interface TestFrame {
  frameTreeNodeId: number;
  url: string;
  parent: TestFrame | null;
  framesInSubtree: TestFrame[];
  detached: boolean;
  isDestroyed: () => boolean;
}

const frame = (frameTreeNodeId: number, url: string, parent: TestFrame | null): TestFrame => ({
  frameTreeNodeId,
  url,
  parent,
  framesInSubtree: [],
  detached: false,
  isDestroyed: () => false,
});

describe('preview request security', () => {
  it('isolates simultaneous preview policies by the actual requesting frame', () => {
    let beforeRequest: RequestListener | undefined;
    const send = vi.fn();
    const mainFrame = frame(1, 'file:///app/renderer/index.html', null);
    const frameA = frame(2, 'component-vault-preview://sandbox/preview.html#preview-a', mainFrame);
    const frameB = frame(3, 'component-vault-preview://sandbox/preview.html#preview-b', mainFrame);
    mainFrame.framesInSubtree = [mainFrame, frameA, frameB];
    const security = createPreviewSecurityController();
    security.attach({
      id: 42,
      mainFrame,
      session: { webRequest: { onBeforeRequest: (_filter, listener) => { beforeRequest = listener; } } },
      on: vi.fn(),
      send,
    }, 'component-vault-preview://sandbox/preview.html');
    security.configure(42, { previewId: 'preview-a', allowedOrigins: ['https://a.example.test'] });
    security.configure(42, { previewId: 'preview-b', allowedOrigins: ['https://b.example.test'] });

    const decision = (requestFrame: TestFrame, url: string) => {
      const callback = vi.fn();
      beforeRequest?.({
        webContentsId: 42,
        url,
        resourceType: 'image',
        frame: requestFrame,
      }, callback);
      return callback.mock.calls[0]?.[0];
    };

    expect(decision(frameA, 'https://a.example.test/a.png')).toEqual({});
    expect(decision(frameA, 'https://b.example.test/cross.png')).toEqual({ cancel: true });
    expect(decision(frameB, 'https://b.example.test/b.png')).toEqual({});
    expect(decision(frameB, 'https://a.example.test/cross.png')).toEqual({ cancel: true });
    expect(send).toHaveBeenCalledWith('preview:request-blocked', {
      previewId: 'preview-a',
      url: 'https://b.example.test/cross.png',
      origin: 'https://b.example.test',
    });
    expect(send).toHaveBeenCalledWith('preview:request-blocked', {
      previewId: 'preview-b',
      url: 'https://a.example.test/cross.png',
      origin: 'https://a.example.test',
    });

    security.configure(42, { previewId: 'preview-a', allowedOrigins: ['https://a2.example.test'] });
    expect(decision(frameB, 'https://b.example.test/still-allowed.png')).toEqual({});

    security.release(42, 'preview-a');
    expect(decision(frameA, 'https://a2.example.test/released.png')).toEqual({ cancel: true });
    expect(decision(frameB, 'https://b.example.test/after-a-unmount.png')).toEqual({});
  });

  it('allows the local preview bootstrap and exact opted-in HTTPS resources only', () => {
    let beforeRequest: RequestListener | undefined;
    const mainFrame = frame(10, 'file:///app/renderer/index.html', null);
    const previewFrame = frame(11, 'file:///app/renderer/preview/preview.html#preview-id', mainFrame);
    mainFrame.framesInSubtree = [mainFrame, previewFrame];
    const webContents = {
      id: 42,
      mainFrame,
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
        frame: isSubframe ? previewFrame : mainFrame,
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
    const mainFrame = frame(20, 'file:///app/index.html', null);
    const previewFrame = frame(21, 'file:///app/preview/preview.html#preview-id', mainFrame);
    mainFrame.framesInSubtree = [mainFrame, previewFrame];
    const security = createPreviewSecurityController({ onBlockedRequest });
    security.attach({
      id: 7,
      mainFrame,
      session: { webRequest: { onBeforeRequest: (_filter, listener) => { beforeRequest = listener; } } },
      on: vi.fn(),
    }, 'file:///app/preview/preview.html');
    const details = {
      webContentsId: 7,
      url: 'https://blocked.example.test/navigation',
      resourceType: 'subFrame',
      frame: previewFrame,
    };

    beforeRequest?.(details, vi.fn());

    expect(onBlockedRequest).toHaveBeenCalledWith(details);
  });

  it('reports a denied HTTPS subresource to the renderer with the active preview ID', () => {
    let beforeRequest: RequestListener | undefined;
    const send = vi.fn();
    const mainFrame = frame(30, 'file:///app/index.html', null);
    const previewFrame = frame(31, 'component-vault-preview://sandbox/preview.html#active-id', mainFrame);
    mainFrame.framesInSubtree = [mainFrame, previewFrame];
    const security = createPreviewSecurityController();
    security.attach({
      id: 9,
      mainFrame,
      session: { webRequest: { onBeforeRequest: (_filter, listener) => { beforeRequest = listener; } } },
      on: vi.fn(),
      send,
    }, 'component-vault-preview://sandbox/preview.html');
    security.configure(9, { previewId: 'active-id', allowedOrigins: [] });

    beforeRequest?.({
      webContentsId: 9,
      url: 'https://images.example.test/photo.png',
      resourceType: 'image',
      frame: previewFrame,
    }, vi.fn());

    expect(send).toHaveBeenCalledWith('preview:request-blocked', {
      previewId: 'active-id',
      url: 'https://images.example.test/photo.png',
      origin: 'https://images.example.test',
    });
  });
});
