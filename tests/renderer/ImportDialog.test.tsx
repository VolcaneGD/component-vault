import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ComponentDraft,
  ComponentRecord,
  ComponentSaveInput,
  LibraryRecord,
} from '../../src/shared/contracts';
import { ImportDialog } from '../../src/renderer/src/features/import/ImportDialog';

const library: LibraryRecord = {
  id: 'library-1',
  name: 'Design system',
  description: '',
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
};

const draft: ComponentDraft = {
  name: 'Primary Button',
  description: '',
  category: '',
  html: '<button>Save</button>',
  css: 'button { color: white; }',
  javascript: '',
  sourceType: 'import',
  originalFileName: 'button.html',
  tags: [],
  previewPolicy: {
    allowScripts: false,
    allowForms: false,
    allowPopups: false,
    externalNetworkEnabled: false,
    allowedOrigins: [],
  },
};

const savedRecord = (input: ComponentSaveInput): ComponentRecord => ({
  ...input,
  id: 'component-1',
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
  deletedAt: null,
});

let importHtmlFiles: ReturnType<typeof vi.fn>;
let saveComponent: ReturnType<typeof vi.fn>;

beforeEach(() => {
  importHtmlFiles = vi.fn().mockResolvedValue([
    { ok: true, draft },
    { ok: false, fileName: 'broken.html', message: 'Decode failed' },
  ]);
  saveComponent = vi.fn(async (input: ComponentSaveInput) => savedRecord(input));
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      importHtmlFiles,
      saveComponent,
      saveLibrary: vi.fn(),
      getPathForFile: (file: File) => `C:\\fixtures\\${file.name}`,
    },
  });
});

afterEach(cleanup);

describe('ImportDialog', () => {
  it('keeps a successful candidate when another selected file fails', async () => {
    const user = userEvent.setup();
    render(<ImportDialog mode="files" libraries={[library]} selectedLibraryId={library.id} />);

    const picker = screen.getByLabelText('HTML files');
    const good = new File(['<button>Save</button>'], 'button.html', { type: 'text/html' });
    const broken = new File(['broken'], 'broken.html', { type: 'text/html' });
    await user.upload(picker, [good, broken]);

    expect(await screen.findByText('broken.html')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Primary Button')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Decode failed')).toBeInTheDocument();
    expect(screen.getByText(`${draft.html.length + draft.css.length} characters`)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Name for button.html'));
    await user.type(screen.getByLabelText('Name for button.html'), 'Updated Button');
    await user.click(screen.getByRole('button', { name: 'Add 1 component' }));

    expect(saveComponent).toHaveBeenCalledOnce();
    expect(saveComponent).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: library.id,
      name: 'Updated Button',
      originalFileName: 'button.html',
    }));
    expect(screen.getByText('Decode failed')).toBeInTheDocument();
  });

  it('requires explicit permission and shows the exact name and size before retrying a large file', async () => {
    importHtmlFiles
      .mockResolvedValueOnce([{ ok: false, fileName: 'large.html', message: 'File exceeds 5 MiB; confirm to import it' }])
      .mockResolvedValueOnce([{ ok: true, draft: { ...draft, name: 'Large card', originalFileName: 'large.html' } }]);
    const largeFile = new File(['oversized'], 'large.html', { type: 'text/html' });
    Object.defineProperty(largeFile, 'size', { value: 5_242_881 });
    const user = userEvent.setup();
    render(<ImportDialog mode="files" libraries={[library]} selectedLibraryId={library.id} />);

    await user.upload(screen.getByLabelText('HTML files'), largeFile);
    const warning = await screen.findByRole('alert');
    expect(within(warning).getByText(/large\.html —/)).toBeInTheDocument();
    expect(within(warning).getByText(/5,242,881 bytes/)).toBeInTheDocument();
    expect(importHtmlFiles).toHaveBeenCalledTimes(1);

    await user.click(within(warning).getByRole('button', { name: 'Allow and retry large.html' }));
    expect(importHtmlFiles).toHaveBeenLastCalledWith(
      ['C:\\fixtures\\large.html'],
      { allowLargeFiles: true },
    );
    expect(await screen.findByDisplayValue('Large card')).toBeInTheDocument();
  });

  it('starts a blank code draft in the chosen library', async () => {
    const onStartCode = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportDialog
        mode="code"
        libraries={[library]}
        selectedLibraryId={library.id}
        onStartCode={onStartCode}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start coding' }));
    expect(onStartCode).toHaveBeenCalledWith(library.id);
  });

  it('keeps a database save failure retryable without reimporting or duplicating successes', async () => {
    const secondaryDraft = {
      ...draft,
      name: 'Secondary Button',
      originalFileName: 'secondary.html',
    };
    importHtmlFiles.mockResolvedValueOnce([
      { ok: true, draft },
      { ok: true, draft: secondaryDraft },
    ]);
    saveComponent
      .mockImplementationOnce(async (input: ComponentSaveInput) => savedRecord(input))
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockImplementationOnce(async (input: ComponentSaveInput) => savedRecord(input));
    const user = userEvent.setup();
    render(<ImportDialog mode="files" libraries={[library]} selectedLibraryId={library.id} />);

    await user.upload(
      screen.getByLabelText('HTML files'),
      [
        new File([draft.html], 'button.html', { type: 'text/html' }),
        new File([draft.html], 'secondary.html', { type: 'text/html' }),
      ],
    );
    await user.click(await screen.findByRole('button', { name: 'Add 2 components' }));

    expect(screen.getByText('Could not save this component.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add 1 component' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Add 1 component' }));

    expect(saveComponent).toHaveBeenCalledTimes(3);
    expect(saveComponent.mock.calls.filter(([input]) => input.name === 'Primary Button')).toHaveLength(1);
    expect(saveComponent.mock.calls.filter(([input]) => input.name === 'Secondary Button')).toHaveLength(2);
    expect(await screen.findAllByText('Added')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Add 0 components' })).toBeDisabled();
  });

  it('accepts dropped HTML files through the same import path', async () => {
    importHtmlFiles.mockResolvedValueOnce([{ ok: true, draft }]);
    render(<ImportDialog mode="files" libraries={[library]} selectedLibraryId={library.id} />);
    const file = new File(['<button>Save</button>'], 'button.html', { type: 'text/html' });

    fireEvent.drop(screen.getByRole('group', { name: 'Drop HTML files' }), {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => expect(importHtmlFiles).toHaveBeenCalledWith(
      ['C:\\fixtures\\button.html'],
      undefined,
    ));
  });

  it('offers merge or new-library choices for a Component Vault bundle', async () => {
    importHtmlFiles.mockResolvedValueOnce([{
      ok: true,
      fileName: 'exported-library.html',
      bundle: {
        format: 'component-vault',
        version: 1,
        library: { name: 'Imported kit', description: 'From export' },
        components: [{
          name: 'Imported card',
          description: '',
          category: 'Cards',
          tags: [],
          html: '<article>Card</article>',
          css: '',
          javascript: '',
          previewPolicy: draft.previewPolicy,
        }],
      },
    }]);
    const saveLibrary = vi.fn().mockResolvedValue({ ...library, id: 'library-2', name: 'Imported kit' });
    Object.defineProperty(window, 'componentVault', {
      configurable: true,
      value: {
        importHtmlFiles,
        saveComponent,
        saveLibrary,
        getPathForFile: (file: File) => `C:\\fixtures\\${file.name}`,
      },
    });
    const user = userEvent.setup();
    render(<ImportDialog mode="files" libraries={[library]} selectedLibraryId={library.id} />);

    await user.upload(
      screen.getByLabelText('HTML files'),
      new File(['export'], 'exported-library.html', { type: 'text/html' }),
    );

    expect(await screen.findByText('Component Vault library detected')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Merge into selected library' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Create Imported kit as a new library' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Create Imported kit as a new library' }));
    await user.click(screen.getByRole('button', { name: 'Add 1 component' }));

    expect(saveLibrary).toHaveBeenCalledWith({ name: 'Imported kit', description: 'From export' });
    expect(saveComponent).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'library-2',
      name: 'Imported card',
    }));
  });
});
