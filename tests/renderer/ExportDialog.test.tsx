import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentRecord, LibraryRecord } from '../../src/shared/contracts';
import { ExportDialog } from '../../src/renderer/src/features/export/ExportDialog';

const library: LibraryRecord = {
  id: 'library-1',
  name: 'Design system',
  description: 'Reusable controls',
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
};

const component = (id: string, name: string): ComponentRecord => ({
  id,
  libraryId: library.id,
  name,
  description: '',
  category: 'Buttons',
  tags: ['ui'],
  html: `<button>${name}</button>`,
  css: 'button { color: white; }',
  javascript: 'globalThis.clicked = true;',
  sourceType: 'manual',
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
});

let copyText: ReturnType<typeof vi.fn>;
let saveStandaloneHtml: ReturnType<typeof vi.fn>;
let saveCssFile: ReturnType<typeof vi.fn>;

beforeEach(() => {
  copyText = vi.fn().mockResolvedValue(undefined);
  saveStandaloneHtml = vi.fn().mockResolvedValue({ ok: true, path: 'C:\\exports\\library.html' });
  saveCssFile = vi.fn().mockResolvedValue({ ok: true, path: 'C:\\exports\\button.css' });
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: { copyText, saveStandaloneHtml, saveCssFile },
  });
});

afterEach(cleanup);

describe('ExportDialog', () => {
  it('exports only checked components as a versioned Component Vault payload', async () => {
    const user = userEvent.setup();
    render(<ExportDialog library={library} components={[component('one', 'One'), component('two', 'Two')]} />);

    await user.click(screen.getByRole('checkbox', { name: 'Include Two' }));
    await user.click(screen.getByRole('button', { name: 'Save standalone HTML' }));

    expect(saveStandaloneHtml).toHaveBeenCalledWith(expect.objectContaining({
      format: 'component-vault',
      version: 1,
      library: { name: 'Design system', description: 'Reusable controls' },
      components: [expect.objectContaining({ name: 'One' })],
    }));
  });

  it('uses typed clipboard and save bridges for copy actions and CSS download', async () => {
    const user = userEvent.setup();
    render(<ExportDialog library={library} components={[component('one', 'Primary Button')]} />);

    await user.click(screen.getByRole('button', { name: 'Copy CSS-linked HTML' }));
    expect(copyText).toHaveBeenLastCalledWith(
      '<link rel="stylesheet" href="Primary-Button.css">\n<button>Primary Button</button>',
    );
    expect(copyText.mock.calls[0][0]).not.toContain('globalThis.clicked');

    await user.click(screen.getByRole('button', { name: 'Copy full code' }));
    expect(copyText.mock.calls[1][0]).toContain('globalThis.clicked = true;');

    await user.click(screen.getByRole('button', { name: 'Save CSS file' }));
    expect(saveCssFile).toHaveBeenCalledWith('Primary-Button.css', 'button { color: white; }');
  });

  it('keeps the dialog retryable when saving fails', async () => {
    saveStandaloneHtml.mockResolvedValueOnce({ ok: false, message: 'disk unavailable' });
    const user = userEvent.setup();
    render(<ExportDialog library={library} components={[component('one', 'One')]} />);

    await user.click(screen.getByRole('button', { name: 'Save standalone HTML' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('disk unavailable');
    expect(screen.getByRole('button', { name: 'Save standalone HTML' })).toBeEnabled();
  });
});
