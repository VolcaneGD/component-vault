import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  installPreviewProtocol,
  registerPreviewScheme,
} from '../../src/main/security/previewProtocol';

describe('preview protocol', () => {
  it('registers a secure standard scheme before application readiness', () => {
    const registerSchemesAsPrivileged = vi.fn();

    registerPreviewScheme({ registerSchemesAsPrivileged });

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([{
      scheme: 'component-vault-preview',
      privileges: expect.objectContaining({ secure: true, standard: true, supportFetchAPI: true }),
    }]);
  });

  it('serves only the two static preview assets', async () => {
    let handler: ((request: Request) => Promise<Response>) | undefined;
    installPreviewProtocol({
      handle: vi.fn((_scheme, nextHandler) => { handler = nextHandler; }),
    }, resolve('src/renderer/public/preview'));

    const html = await handler!(new Request('component-vault-preview://sandbox/preview.html'));
    const script = await handler!(new Request('component-vault-preview://sandbox/preview-bootstrap.js'));
    const traversal = await handler!(new Request('component-vault-preview://sandbox/../package.json'));

    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');
    expect(await html.text()).toContain('Content-Security-Policy');
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(traversal.status).toBe(404);
  });
});
