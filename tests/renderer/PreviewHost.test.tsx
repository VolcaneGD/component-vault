import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentRecord } from '../../src/shared/contracts';
import { PREVIEW_CHANNEL } from '../../src/renderer/src/features/preview/buildPreviewDocument';
import { PreviewHost } from '../../src/renderer/src/features/preview/PreviewHost';

afterEach(cleanup);

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

const previewIdFrom = (iframe: HTMLIFrameElement): string => {
  const match = iframe.srcdoc.match(/const previewId = "([A-Za-z0-9_-]+)"/);
  if (!match) throw new Error('Preview ID not found in srcdoc');
  return match[1];
};

const dispatchPreviewError = (
  iframe: HTMLIFrameElement,
  previewId: string,
  source: MessageEventSource | null,
  error: Record<string, unknown> = { type: 'runtime', message: 'Preview failed' },
) => {
  fireEvent(window, new MessageEvent('message', {
    source,
    data: { channel: PREVIEW_CHANNEL, previewId, error },
  }));
};

describe('PreviewHost', () => {
  it('uses a restricted sandbox without same-origin, popup, navigation, or download privileges', () => {
    render(<PreviewHost component={component()} />);

    const iframe = screen.getByTitle('Component preview');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    expect(iframe).not.toHaveAttribute('allow');
  });

  it('ignores a forged parent-window message even when its preview ID matches', () => {
    render(<PreviewHost component={component()} />);
    const iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;

    dispatchPreviewError(iframe, previewIdFrom(iframe), window);

    expect(screen.queryByText('Preview failed')).not.toBeInTheDocument();
  });

  it('ignores a message from the iframe when its preview ID does not match', () => {
    render(<PreviewHost component={component()} />);
    const iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;

    dispatchPreviewError(iframe, 'different-preview-id', iframe.contentWindow);

    expect(screen.queryByText('Preview failed')).not.toBeInTheDocument();
  });

  it('shows serialized iframe errors with location and supports clear and reload', () => {
    render(<PreviewHost component={component()} />);
    const iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;
    const initialDocument = iframe.srcdoc;

    dispatchPreviewError(iframe, previewIdFrom(iframe), iframe.contentWindow, {
      type: 'runtime',
      message: 'Cannot read properties of null',
      line: 12,
      column: 7,
    });

    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getByText('Cannot read properties of null')).toBeInTheDocument();
    expect(screen.getByText('Line 12, column 7')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear errors' }));
    expect(screen.queryByText('Cannot read properties of null')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reload preview' }));
    expect(iframe.srcdoc).not.toBe(initialDocument);
  });

  it('offers to add a blocked HTTPS origin to the preview policy', () => {
    const onPreviewPolicyChange = vi.fn();
    render(
      <PreviewHost
        component={component()}
        onPreviewPolicyChange={onPreviewPolicyChange}
      />,
    );
    const iframe = screen.getByTitle('Component preview') as HTMLIFrameElement;

    dispatchPreviewError(iframe, previewIdFrom(iframe), iframe.contentWindow, {
      type: 'csp',
      message: 'Blocked by Content Security Policy: img-src',
      blockedOrigin: 'https://images.example.com',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Allow https://images.example.com' }));

    expect(onPreviewPolicyChange).toHaveBeenCalledWith(expect.objectContaining({
      externalNetworkEnabled: true,
      allowedOrigins: ['https://images.example.com'],
    }));
    expect(iframe.srcdoc).toContain('https://images.example.com');
  });
});
