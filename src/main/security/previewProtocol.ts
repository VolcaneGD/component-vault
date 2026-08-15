import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const PREVIEW_SCHEME = 'component-vault-preview';
export const PREVIEW_DOCUMENT_URL = `${PREVIEW_SCHEME}://sandbox/preview.html`;

interface SchemeRegistrar {
  registerSchemesAsPrivileged: (schemes: Array<{
    scheme: string;
    privileges: Record<string, boolean>;
  }>) => void;
}

interface ProtocolHandlerRegistrar {
  handle: (
    scheme: string,
    handler: (request: Request) => Promise<Response>,
  ) => unknown;
}

export const registerPreviewScheme = (protocol: SchemeRegistrar): void => {
  protocol.registerSchemesAsPrivileged([{
    scheme: PREVIEW_SCHEME,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }]);
};

export const installPreviewProtocol = (
  protocol: ProtocolHandlerRegistrar,
  previewDirectory: string,
): void => {
  const assets = new Map([
    ['/preview.html', { file: 'preview.html', contentType: 'text/html; charset=utf-8' }],
    ['/preview-bootstrap.js', { file: 'preview-bootstrap.js', contentType: 'text/javascript; charset=utf-8' }],
  ]);

  protocol.handle(PREVIEW_SCHEME, async (request) => {
    const url = new URL(request.url);
    const asset = url.host === 'sandbox' ? assets.get(url.pathname) : undefined;
    if (!asset) return new Response('Not found', { status: 404 });

    try {
      const contents = await readFile(join(previewDirectory, asset.file));
      return new Response(contents, {
        status: 200,
        headers: {
          'Content-Type': asset.contentType,
          'Cross-Origin-Resource-Policy': 'same-origin',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
};
