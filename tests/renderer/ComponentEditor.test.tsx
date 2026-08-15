import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentRecord, ComponentSaveInput } from '../../src/shared/contracts';
import { ComponentEditor } from '../../src/renderer/src/features/editor/ComponentEditor';

vi.mock('../../src/renderer/src/features/editor/MonacoEditorAdapter', () => ({
  MonacoEditor: ({ language, path, value, onChange }: {
    language: string;
    path: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      data-testid={`${language}-editor-fallback`}
      data-model-path={path}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
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
