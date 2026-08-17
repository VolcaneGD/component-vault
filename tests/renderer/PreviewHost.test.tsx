import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAppSettings, type ComponentRecord, type PreviewPolicy } from '../../src/shared/contracts';
import {
  PREVIEW_EVENT_CHANNEL,
  PREVIEW_READY_CHANNEL,
} from '../../src/renderer/src/features/preview/previewProtocol';
import { PreviewHost } from '../../src/renderer/src/features/preview/PreviewHost';
import { useAppStore } from '../../src/renderer/src/store/useAppStore';

const configurePreviewNetwork = vi.fn().mockResolvedValue(undefined);
const releasePreviewNetwork = vi.fn().mockResolvedValue(undefined);
let blockedRequestListener: ((event: {
  previewId: string;
  url: string;
  origin: string;
}) => void) | undefined;

beforeEach(() => {
  configurePreviewNetwork.mockClear();
  releasePreviewNetwork.mockClear();
  blockedRequestListener = undefined;
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      saveAppSettings: vi.fn().mockResolvedValue(defaultAppSettings()),
      configurePreviewNetwork,
      releasePreviewNetwork,
      onPreviewRequestBlocked: (listener: typeof blockedRequestListener) => {
        blockedRequestListener = listener;
        return () => { blockedRequestListener = undefined; };
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const component = (overrides: Partial<ComponentRecord> = {}): ComponentRecord => ({
  id: 'component-1',
  libraryId: 'library-1',
  name: 'Preview component',
  description: '',
  category: '',
  tags: [],
  html: '<button>Run</button>',
  css: 'button { color: rebeccapurple; }',
  javascript: 'document.body.dataset.ready = "true";',
  sourceType: 'html',
  originalFileName: null,
  previewPolicy: {
    allowScripts: true,
    allowForms: false,
    allowPopups: false,
    externalNetworkEnabled: false,
    allowedOrigins: [],
  },
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

const previewIdFrom = (iframe: HTMLIFrameElement): string => new URL(iframe.src).hash.slice(1);

const dispatchPreviewMessage = (
  iframe: HTMLIFrameElement,
  data: Record<string, unknown>,
  source: MessageEventSource | null = iframe.contentWindow,
) => fireEvent(window, new MessageEvent('message', { source, data }));

const dispatchPreviewError = (
  iframe: HTMLIFrameElement,
  error: Record<string, unknown> = { type: 'runtime', message: 'Preview failed' },
  overrides: Record<string, unknown> = {},
) => dispatchPreviewMessage(iframe, {
  channel: PREVIEW_EVENT_CHANNEL,
  previewId: previewIdFrom(iframe),
  error,
  ...overrides,
});

const readyPreview = async (iframe: HTMLIFrameElement) => {
  const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');
  dispatchPreviewMessage(iframe, {
    channel: PREVIEW_READY_CHANNEL,
    previewId: previewIdFrom(iframe),
  });
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
    channel: 'component-vault:preview:init',
    previewId: previewIdFrom(iframe),
  }), '*'));
  return postMessage;
};

describe('PreviewHost', () => {
  it('applies the selected shared preview canvas theme to its iframe', () => {
    useAppStore.setState({ settings: { ...defaultAppSettings(), previewTheme: 'dark' } });

    render(<PreviewHost component={component()} />);

    expect(screen.getByTitle('Component preview')).toHaveAttribute('data-preview-theme', 'dark');
  });

  it('sends a changed canvas theme into an already-ready preview document', async () => {
    useAppStore.setState({ settings: { ...defaultAppSettings(), previewTheme: 'light' } });
    render(<PreviewHost component={component()} />);
    const iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;
    const postMessage = await readyPreview(iframe);

    act(() => useAppStore.setState((state) => ({
      settings: { ...state.settings, previewTheme: 'dark' },
    })));

    await waitFor(() => expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      component: expect.objectContaining({ previewTheme: 'dark' }),
    }), '*'));
  });

  it('does not resend preview code when a non-preview component field changes', async () => {
    useAppStore.setState({ settings: { ...defaultAppSettings(), previewTheme: 'light' } });
    const first = component();
    const { rerender } = render(<PreviewHost component={first} />);
    const iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;
    const postMessage = await readyPreview(iframe);
    postMessage.mockClear();

    rerender(<PreviewHost component={{ ...first, name: 'Renamed preview component' }} />);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('releases only its preview instance when the frame unmounts', () => {
    const { unmount } = render(<PreviewHost component={component()} />);
    const previewId = previewIdFrom(screen.getByTitle('Component preview') as HTMLIFrameElement);

    unmount();

    expect(releasePreviewNetwork).toHaveBeenCalledOnce();
    expect(releasePreviewNetwork).toHaveBeenCalledWith(previewId);
  });

  it('loads the static child with the restricted opaque-origin sandbox', () => {
    render(<PreviewHost component={component()} />);

    const iframe = screen.getByTitle('Component preview');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    expect(iframe).not.toHaveAttribute('srcdoc');
    expect(iframe).not.toHaveAttribute('allow');
    expect(iframe).toHaveAttribute(
      'src',
      expect.stringMatching(/^component-vault-preview:\/\/sandbox\/preview\.html#[A-Za-z0-9_-]+$/),
    );
  });

  it('sends code only after authenticated readiness and preserves source plus ID validation', async () => {
    render(<PreviewHost component={component()} />);
    const iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    dispatchPreviewMessage(iframe, {
      channel: PREVIEW_READY_CHANNEL,
      previewId: previewIdFrom(iframe),
    }, window);
    dispatchPreviewMessage(iframe, {
      channel: PREVIEW_READY_CHANNEL,
      previewId: 'wrong-id',
    });
    expect(postMessage).not.toHaveBeenCalled();

    await readyPreview(iframe);
    expect(configurePreviewNetwork).toHaveBeenCalledWith({
      previewId: previewIdFrom(iframe),
      allowedOrigins: [],
    });

    dispatchPreviewError(iframe, { type: 'runtime', message: 'Forged' }, { previewId: 'wrong-id' });
    dispatchPreviewMessage(iframe, {
      channel: PREVIEW_EVENT_CHANNEL,
      previewId: previewIdFrom(iframe),
      error: { type: 'runtime', message: 'Forged' },
    }, window);
    expect(screen.queryByText('Forged')).not.toBeInTheDocument();
  });

  it('does not offer or grant a blocked origin without a persistence callback', async () => {
    render(<PreviewHost component={component()} />);
    const iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;
    await readyPreview(iframe);

    dispatchPreviewError(iframe, {
      type: 'csp',
      message: 'Blocked image',
      blockedOrigin: 'https://images.example.com',
    });

    expect(screen.queryByRole('button', { name: 'Allow https://images.example.com' })).not.toBeInTheDocument();
    expect(configurePreviewNetwork).not.toHaveBeenCalledWith(expect.objectContaining({
      allowedOrigins: ['https://images.example.com'],
    }));
  });

  it('does not grant a blocked origin when persistence fails', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('disk unavailable'));
    render(<PreviewHost component={component()} onPreviewPolicyChange={persist} />);
    const iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;
    await readyPreview(iframe);
    dispatchPreviewError(iframe, {
      type: 'csp', message: 'Blocked image', blockedOrigin: 'https://images.example.com',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Allow https://images.example.com' }));

    expect(await screen.findByText('Could not save preview policy: disk unavailable')).toBeInTheDocument();
    expect(configurePreviewNetwork).not.toHaveBeenCalledWith(expect.objectContaining({
      allowedOrigins: ['https://images.example.com'],
    }));
  });

  it('turns a matching Main Process request cancellation into blocked-origin guidance', () => {
    const persist = vi.fn().mockResolvedValue(component().previewPolicy);
    render(<PreviewHost component={component()} onPreviewPolicyChange={persist} />);
    const iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;

    act(() => {
      blockedRequestListener?.({
        previewId: previewIdFrom(iframe),
        url: 'https://images.example.com/large-photo.png',
        origin: 'https://images.example.com',
      });
    });

    expect(screen.getByText('Blocked external preview resource')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow https://images.example.com' })).toBeInTheDocument();
  });

  it('activates only the authoritative policy returned after persistence', async () => {
    const savedPolicy: PreviewPolicy = {
      allowScripts: true,
      allowForms: false,
      allowPopups: false,
      externalNetworkEnabled: true,
      allowedOrigins: ['https://images.example.com'],
    };
    const persist = vi.fn().mockResolvedValue(savedPolicy);
    render(<PreviewHost component={component()} onPreviewPolicyChange={persist} />);
    let iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;
    await readyPreview(iframe);
    dispatchPreviewError(iframe, {
      type: 'csp', message: 'Blocked image', blockedOrigin: 'https://images.example.com',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Allow https://images.example.com' }));
    await waitFor(() => expect(persist).toHaveBeenCalled());
    iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;
    await readyPreview(iframe);

    expect(configurePreviewNetwork).toHaveBeenLastCalledWith(expect.objectContaining({
      allowedOrigins: ['https://images.example.com'],
    }));
  });

  it('uses updated props and never reuses a previous component policy during a switch', async () => {
    const first = component({
      previewPolicy: {
        allowScripts: true,
        allowForms: false,
        allowPopups: false,
        externalNetworkEnabled: true,
        allowedOrigins: ['https://first.example.com'],
      },
    });
    const { rerender } = render(<PreviewHost component={first} />);
    await readyPreview(screen.getByTitle('Component preview') as HTMLIFrameElement);

    rerender(<PreviewHost component={component({ id: 'component-2', updatedAt: first.updatedAt })} />);
    const secondFrame = screen.getByTitle('Component preview') as HTMLIFrameElement;
    await readyPreview(secondFrame);

    expect(configurePreviewNetwork).toHaveBeenLastCalledWith(expect.objectContaining({
      allowedOrigins: [],
    }));
  });

  it('creates a fresh static child when live component code changes', () => {
    const { rerender } = render(<PreviewHost component={component()} />);
    const firstSource = (screen.getByTitle('Component preview') as HTMLIFrameElement).src;

    rerender(<PreviewHost component={component({ html: '<p>Updated live</p>' })} />);

    expect((screen.getByTitle('Component preview') as HTMLIFrameElement).src).not.toBe(firstSource);
  });

  it('rate-limits error bursts and retains a fixed maximum error list', () => {
    vi.useFakeTimers();
    render(<PreviewHost component={component()} />);
    const iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;

    for (let index = 0; index < 25; index += 1) {
      dispatchPreviewError(iframe, { type: 'runtime', message: `Burst ${index}` });
    }
    expect(screen.getAllByRole('listitem')).toHaveLength(20);

    vi.advanceTimersByTime(1_001);
    for (let index = 0; index < 20; index += 1) {
      dispatchPreviewError(iframe, { type: 'runtime', message: `Second ${index}` });
    }
    vi.advanceTimersByTime(1_001);
    for (let index = 0; index < 20; index += 1) {
      dispatchPreviewError(iframe, { type: 'runtime', message: `Third ${index}` });
    }
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
  });
});
