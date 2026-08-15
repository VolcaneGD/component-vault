import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentRecord, ComponentSaveInput } from '../../src/shared/contracts';
import { ComponentEditor } from '../../src/renderer/src/features/editor/ComponentEditor';

const { disposeComponentModels } = vi.hoisted(() => ({
  disposeComponentModels: vi.fn(),
}));

vi.mock('../../src/renderer/src/features/editor/MonacoEditorAdapter', () => ({
  MonacoEditor: ({ language, path, value, onChange, onMount }: {
    language: string;
    path: string;
    value: string;
    onChange: (value: string) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => (
    <textarea
      ref={(node) => {
        if (node && onMount) {
          onMount({
            focus: () => node.focus(),
            addCommand: vi.fn(),
            getAction: vi.fn(),
          }, {
            KeyMod: { CtrlCmd: 1 },
            KeyCode: { KeyS: 1 },
          });
        }
      }}
      data-testid={`${language}-editor-fallback`}
      data-model-path={path}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  mountComponentModels: vi.fn(),
  disposeComponentModels,
}));

const fixture: ComponentRecord = {
  id: 'component-1',
  libraryId: 'library-1',
  name: 'Primary button',
  description: 'Main call to action',
  category: 'Buttons',
  tags: ['primary', 'action'],
  html: '<button>Save</button>',
  css: 'button { color: white; }',
  javascript: 'document.body.dataset.ready = "true";',
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
};

let saveComponent: ReturnType<typeof vi.fn<(input: ComponentSaveInput) => Promise<ComponentRecord>>>;

beforeEach(() => {
  disposeComponentModels.mockClear();
  saveComponent = vi.fn(async (input) => ({
    ...fixture,
    ...input,
    id: input.id ?? 'component-2',
    updatedAt: '2026-08-15T00:00:01.000Z',
  }));
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      saveComponent,
      deleteComponent: vi.fn().mockResolvedValue(true),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ComponentEditor', () => {
  it('keeps a newer transient edit dirty across UUID rekey and persists it before showing saved', async () => {
    vi.useFakeTimers();
    let resolveCreate!: (component: ComponentRecord) => void;
    const createResult = new Promise<ComponentRecord>((resolve) => { resolveCreate = resolve; });
    const persist = vi.fn<(input: ComponentSaveInput) => Promise<ComponentRecord>>()
      .mockReturnValueOnce(createResult)
      .mockImplementationOnce(async (input) => ({
        ...fixture,
        ...input,
        id: input.id!,
        updatedAt: '2026-08-15T00:00:02.000Z',
      }));
    const transient = {
      ...fixture,
      id: 'draft:new',
      name: 'Live button',
      html: '',
      css: '',
      javascript: '',
    };
    const Harness = () => {
      const [component, setComponent] = useState(transient);
      return (
        <ComponentEditor
          component={component}
          isNew={component.id.startsWith('draft:')}
          onSave={async (input) => {
            const saved = await persist(input);
            setComponent(saved);
            return saved;
          }}
        />
      );
    };
    render(<Harness />);

    fireEvent.change(screen.getByTestId('html-editor-fallback'), {
      target: { value: '<button>First</button>' },
    });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(persist).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByTestId('html-editor-fallback'), {
      target: { value: '<button>Latest</button>' },
    });
    await act(async () => resolveCreate({
      ...fixture,
      id: 'a19979d8-cb60-4eb8-bc5f-c905ba14adf0',
      name: 'Live button',
      html: '<button>First</button>',
      css: '',
      javascript: '',
      updatedAt: '2026-08-15T00:00:01.000Z',
    }));

    expect(screen.getByTestId('html-editor-fallback')).toHaveValue('<button>Latest</button>');
    expect(screen.getByText('Saving')).toBeInTheDocument();
    expect(persist).toHaveBeenCalledOnce();

    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'a19979d8-cb60-4eb8-bc5f-c905ba14adf0',
      html: '<button>Latest</button>',
    }));
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('resets a new code-first draft from JavaScript to HTML', () => {
    const { rerender } = render(<ComponentEditor component={fixture} />);
    fireEvent.click(screen.getByRole('tab', { name: 'JavaScript' }));
    expect(screen.getByRole('tab', { name: 'JavaScript' })).toHaveAttribute('aria-selected', 'true');

    rerender(<ComponentEditor
      component={{ ...fixture, id: 'draft:new', name: '', html: '', css: '', javascript: '' }}
      isNew
      autoFocusHtml
    />);

    expect(screen.getByRole('tab', { name: 'HTML' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('html-editor-fallback')).toHaveFocus();
  });

  it('keeps an invalid new draft live without persisting it', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<ComponentEditor component={{
      ...fixture,
      id: 'draft:new',
      name: '',
      html: '',
      css: '',
      javascript: '',
    }} onChange={onChange} isNew />);

    fireEvent.change(screen.getByTestId('html-editor-fallback'), {
      target: { value: '<button>Preview me</button>' },
    });
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ html: '<button>Preview me</button>' }));
    expect(saveComponent).not.toHaveBeenCalled();
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
  });

  it('persists a new draft only after its name and code are both non-empty', async () => {
    vi.useFakeTimers();
    render(<ComponentEditor component={{
      ...fixture,
      id: 'draft:new',
      name: '',
      html: '',
      css: '',
      javascript: '',
    }} isNew />);

    fireEvent.change(screen.getByLabelText('Component name'), { target: { value: 'Preview button' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(saveComponent).not.toHaveBeenCalled();
    expect(screen.getByText('Add HTML, CSS, or JavaScript before saving.')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('html-editor-fallback'), { target: { value: '<button>Preview</button>' } });
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(saveComponent).toHaveBeenCalledOnce();
  });

  it('keeps separate Monaco models while switching HTML, CSS, and JavaScript tabs', () => {
    render(<ComponentEditor component={fixture} />);

    expect(screen.getByTestId('html-editor-fallback')).toHaveAttribute(
      'data-model-path',
      'component-vault://component-1/html.html',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'CSS' }));
    expect(screen.getByTestId('css-editor-fallback')).toHaveAttribute(
      'data-model-path',
      'component-vault://component-1/css.css',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'JavaScript' }));
    expect(screen.getByTestId('javascript-editor-fallback')).toHaveAttribute(
      'data-model-path',
      'component-vault://component-1/javascript.js',
    );
  });

  it('moves between language tabs with arrow keys', () => {
    render(<ComponentEditor component={fixture} />);

    const htmlTab = screen.getByRole('tab', { name: 'HTML' });
    htmlTab.focus();
    fireEvent.keyDown(htmlTab, { key: 'ArrowRight' });

    expect(screen.getByRole('tab', { name: 'CSS' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'CSS' })).toHaveFocus();
  });

  it('retains models across tabs and disposes a component model set when it closes', () => {
    const { rerender, unmount } = render(<ComponentEditor component={fixture} />);

    fireEvent.click(screen.getByRole('tab', { name: 'CSS' }));
    fireEvent.click(screen.getByRole('tab', { name: 'JavaScript' }));
    expect(disposeComponentModels).not.toHaveBeenCalled();

    rerender(<ComponentEditor component={{ ...fixture, id: 'component-2' }} />);
    expect(disposeComponentModels).toHaveBeenCalledWith('component-1');

    unmount();
    expect(disposeComponentModels).toHaveBeenLastCalledWith('component-2');
  });

  it('debounces editor changes for 500 ms and reports saved state', async () => {
    vi.useFakeTimers();
    render(<ComponentEditor component={fixture} />);

    fireEvent.change(screen.getByTestId('html-editor-fallback'), {
      target: { value: '<button>New</button>' },
    });
    expect(screen.getByText('Saving')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(saveComponent).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(saveComponent).toHaveBeenCalledOnce();
    expect(saveComponent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'component-1',
      html: '<button>New</button>',
    }));
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('retains dirty fields after a failed autosave and retries the same draft manually', async () => {
    vi.useFakeTimers();
    saveComponent
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockImplementationOnce(async (input) => ({ ...fixture, ...input }));
    render(<ComponentEditor component={fixture} />);

    fireEvent.change(screen.getByLabelText('Component name'), {
      target: { value: 'Unsaved button' },
    });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    expect(screen.getByLabelText('Component name')).toHaveValue('Unsaved button');

    fireEvent.click(screen.getByRole('button', { name: 'Save component' }));
    await act(() => vi.runAllTimersAsync());

    expect(saveComponent).toHaveBeenCalledTimes(2);
    expect(saveComponent).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Unsaved button' }));
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('saves metadata, tags, and the network policy from the current draft', async () => {
    vi.useFakeTimers();
    render(<ComponentEditor component={fixture} />);

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated details' } });
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'forms, accessible' } });
    fireEvent.click(screen.getByLabelText('Allow external network'));
    fireEvent.change(screen.getByLabelText('Allowed HTTPS origins'), {
      target: { value: 'https://cdn.example.test\nhttps://fonts.example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }));
    await act(() => vi.runAllTimersAsync());

    expect(saveComponent).toHaveBeenLastCalledWith(expect.objectContaining({
      description: 'Updated details',
      tags: ['forms', 'accessible'],
      previewPolicy: expect.objectContaining({
        externalNetworkEnabled: true,
        allowedOrigins: ['https://cdn.example.test', 'https://fonts.example.test'],
      }),
    }));
  });

  it('preserves a trailing tag delimiter while the user enters another tag', () => {
    render(<ComponentEditor component={fixture} />);

    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'forms,' } });

    expect(screen.getByLabelText('Tags')).toHaveValue('forms,');
  });

  it('merges an authoritative preview policy without discarding dirty code', async () => {
    vi.useFakeTimers();
    let latestDraft = fixture;
    const { rerender } = render(
      <ComponentEditor component={fixture} onChange={(next) => { latestDraft = next; }} />,
    );
    fireEvent.change(screen.getByTestId('html-editor-fallback'), {
      target: { value: '<button>Dirty code</button>' },
    });

    rerender(<ComponentEditor
      component={{
        ...latestDraft,
        previewPolicy: {
          ...latestDraft.previewPolicy,
          externalNetworkEnabled: true,
          allowedOrigins: ['https://images.example.test'],
        },
      }}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }));
    await act(() => vi.runAllTimersAsync());

    expect(saveComponent).toHaveBeenLastCalledWith(expect.objectContaining({
      html: '<button>Dirty code</button>',
      previewPolicy: expect.objectContaining({
        externalNetworkEnabled: true,
        allowedOrigins: ['https://images.example.test'],
      }),
    }));
  });
});
