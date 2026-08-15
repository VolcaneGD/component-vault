import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentRecord } from '../../src/shared/contracts';
import { WorkbenchView } from '../../src/renderer/src/features/shell/WorkbenchView';
import { useAppStore } from '../../src/renderer/src/store/useAppStore';

vi.mock('../../src/renderer/src/features/editor/MonacoEditorAdapter', () => ({
  MonacoEditor: ({ language, value, onChange }: {
    language: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      data-testid={`${language}-editor-fallback`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const component: ComponentRecord = {
  id: 'component-1',
  libraryId: 'library-1',
  name: 'Card',
  description: '',
  category: 'Layout',
  tags: [],
  html: '<article>Card</article>',
  css: 'article { padding: 1rem; }',
  javascript: '',
  sourceType: 'manual',
  originalFileName: null,
  previewPolicy: {
    allowScripts: false,
    allowForms: false,
    allowPopups: false,
    externalNetworkEnabled: false,
    allowedOrigins: [],
  },
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
  deletedAt: null,
};

const saveAppSettings = vi.fn().mockResolvedValue(undefined);
const saveComponent = vi.fn(async (input) => ({ ...component, ...input } as ComponentRecord));

beforeEach(() => {
  saveAppSettings.mockClear();
  saveComponent.mockClear();
  saveComponent.mockImplementation(async (input) => ({ ...component, ...input } as ComponentRecord));
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      saveAppSettings,
      saveComponent,
      deleteComponent: vi.fn().mockResolvedValue(true),
      configurePreviewNetwork: vi.fn().mockResolvedValue(undefined),
      releasePreviewNetwork: vi.fn().mockResolvedValue(undefined),
      onPreviewRequestBlocked: vi.fn(() => () => undefined),
    },
  });
  useAppStore.setState({
    components: [component],
    selectedComponentId: component.id,
    settings: { ...useAppStore.getState().settings, editorPreviewRatio: 0.55 },
  });
});

afterEach(() => {
  cleanup();
});

describe('WorkbenchView', () => {
  it('places the live preview below the selected component editor', () => {
    render(<WorkbenchView />);

    const workbench = screen.getByLabelText('Component workbench');
    const editor = screen.getByLabelText('Component editor');
    const preview = screen.getByLabelText('Live component preview');
    expect(workbench.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy();
    expect(editor.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clamps and persists keyboard splitter changes between 0.25 and 0.8', async () => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, editorPreviewRatio: 0.79 },
    });
    render(<WorkbenchView />);
    const splitter = screen.getByRole('separator', { name: 'Resize editor and preview' });

    fireEvent.keyDown(splitter, { key: 'ArrowDown' });
    fireEvent.keyDown(splitter, { key: 'ArrowDown' });

    expect(splitter).toHaveAttribute('aria-valuenow', '80');
    await waitFor(() => expect(saveAppSettings).toHaveBeenLastCalledWith({ editorPreviewRatio: 0.8 }));
  });

  it('serializes saves so stale editor input cannot overwrite an authoritative preview policy', async () => {
    let finishPolicySave: ((saved: ComponentRecord) => void) | undefined;
    saveComponent
      .mockImplementationOnce(() => new Promise<ComponentRecord>((resolve) => { finishPolicySave = resolve; }))
      .mockImplementationOnce(async (input) => ({ ...component, ...input } as ComponentRecord));
    const policy = {
      ...component.previewPolicy,
      externalNetworkEnabled: true,
      allowedOrigins: ['https://images.example.test'],
    };
    const dirtyComponent = { ...component, html: '<article>Dirty card</article>' };
    useAppStore.getState().updateComponentDraft({ ...dirtyComponent, previewPolicy: policy });

    const policySave = useAppStore.getState().saveComponent({ ...dirtyComponent, previewPolicy: policy });
    const staleAutosave = useAppStore.getState().saveComponent({
      ...dirtyComponent,
    });
    await waitFor(() => expect(saveComponent).toHaveBeenCalledOnce());
    finishPolicySave?.({ ...dirtyComponent, previewPolicy: policy });
    await policySave;
    await staleAutosave;

    expect(saveComponent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      html: '<article>Dirty card</article>',
      previewPolicy: policy,
    }));
  });
});
