import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  mountComponentModels: vi.fn(),
  disposeComponentModels: vi.fn(),
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
const deleteComponent = vi.fn().mockResolvedValue(true);
const componentB: ComponentRecord = {
  ...component,
  id: 'component-2',
  name: 'Secondary card',
  html: '<article>Secondary</article>',
};

beforeEach(() => {
  saveAppSettings.mockClear();
  saveComponent.mockClear();
  saveComponent.mockImplementation(async (input) => ({ ...component, ...input } as ComponentRecord));
  deleteComponent.mockClear();
  deleteComponent.mockResolvedValue(true);
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      saveAppSettings,
      saveComponent,
      deleteComponent,
      configurePreviewNetwork: vi.fn().mockResolvedValue(undefined),
      releasePreviewNetwork: vi.fn().mockResolvedValue(undefined),
      onPreviewRequestBlocked: vi.fn(() => () => undefined),
    },
  });
  useAppStore.setState({
    components: [component],
    componentsLibraryId: component.libraryId,
    selectedLibraryId: component.libraryId,
    selectedComponentId: component.id,
    selectedComponentIds: [],
    draftOrigins: {},
    settings: { ...useAppStore.getState().settings, editorPreviewRatio: 0.55 },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WorkbenchView', () => {
  it('consumes a pending origin when mounting after creation completed without an editor', async () => {
    const draft = {
      ...component,
      id: 'draft:gallery',
      name: 'Gallery draft',
    };
    saveComponent.mockImplementation(async (input) => ({
      ...component,
      ...input,
      id: 'component-created-in-gallery',
      updatedAt: '2026-08-15T00:00:01.000Z',
    } as ComponentRecord));
    useAppStore.setState({
      components: [draft],
      selectedComponentId: draft.id,
    });

    await useAppStore.getState().saveComponent(draft);
    expect(useAppStore.getState().draftOrigins).toEqual({
      'component-created-in-gallery': draft.id,
    });

    render(<WorkbenchView />);
    await waitFor(() => expect(useAppStore.getState().draftOrigins).toEqual({}));
    expect(screen.getByDisplayValue('Gallery draft')).toBeVisible();
  });

  it('consumes a draft origin after the mounted editor accepts its UUID rekey', async () => {
    vi.useFakeTimers();
    const draft = {
      ...component,
      id: 'draft:workbench',
      name: 'Draft card',
    };
    saveComponent.mockImplementation(async (input) => ({
      ...component,
      ...input,
      id: input.id ?? 'component-created',
      updatedAt: '2026-08-15T00:00:01.000Z',
    } as ComponentRecord));
    useAppStore.setState({
      components: [draft],
      selectedComponentId: draft.id,
    });
    render(<WorkbenchView />);

    fireEvent.change(screen.getByTestId('html-editor-fallback'), {
      target: { value: '<article>Created card</article>' },
    });
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(useAppStore.getState().components[0].id).toBe('component-created');
    expect(useAppStore.getState().draftOrigins).toEqual({});
  });

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

  it('preserves an edit made while a save is in flight and sends it in the queued save', async () => {
    let finishFirstSave: ((saved: ComponentRecord) => void) | undefined;
    saveComponent
      .mockImplementationOnce(() => new Promise<ComponentRecord>((resolve) => { finishFirstSave = resolve; }))
      .mockImplementationOnce(async (input) => ({ ...component, ...input } as ComponentRecord));
    const firstSave = useAppStore.getState().saveComponent(component);
    await waitFor(() => expect(saveComponent).toHaveBeenCalledOnce());

    const edited = { ...component, html: '<article>Edited during save</article>' };
    useAppStore.getState().updateComponentDraft(edited);
    const queuedSave = useAppStore.getState().saveComponent(component);
    finishFirstSave?.({ ...component, updatedAt: '2026-08-15T00:00:01.000Z' });
    await firstSave;
    await queuedSave;

    expect(saveComponent).toHaveBeenNthCalledWith(2, expect.objectContaining({ html: edited.html }));
    expect(useAppStore.getState().components[0].html).toBe(edited.html);
  });

  it('preserves an authoritative policy applied while a save is in flight', async () => {
    let finishFirstSave: ((saved: ComponentRecord) => void) | undefined;
    saveComponent
      .mockImplementationOnce(() => new Promise<ComponentRecord>((resolve) => { finishFirstSave = resolve; }))
      .mockImplementationOnce(async (input) => ({ ...component, ...input } as ComponentRecord));
    const firstSave = useAppStore.getState().saveComponent(component);
    await waitFor(() => expect(saveComponent).toHaveBeenCalledOnce());

    const policy = {
      ...component.previewPolicy,
      externalNetworkEnabled: true,
      allowedOrigins: ['https://assets.example.test'],
    };
    useAppStore.getState().updateComponentDraft({ ...component, previewPolicy: policy });
    const queuedSave = useAppStore.getState().saveComponent(component);
    finishFirstSave?.({ ...component, updatedAt: '2026-08-15T00:00:01.000Z' });
    await firstSave;
    await queuedSave;

    expect(saveComponent).toHaveBeenNthCalledWith(2, expect.objectContaining({ previewPolicy: policy }));
    expect(useAppStore.getState().components[0].previewPolicy).toEqual(policy);
  });

  it('cancels queued saves and deletes after an in-flight save without reinserting the component', async () => {
    let finishFirstSave: ((saved: ComponentRecord) => void) | undefined;
    saveComponent.mockImplementationOnce(
      () => new Promise<ComponentRecord>((resolve) => { finishFirstSave = resolve; }),
    );
    const firstSave = useAppStore.getState().saveComponent(component);
    await waitFor(() => expect(saveComponent).toHaveBeenCalledOnce());
    const queuedSave = useAppStore.getState().saveComponent({ ...component, html: '<p>Queued</p>' })
      .catch((error: unknown) => error);
    const deletion = useAppStore.getState().deleteComponent(component.id);

    finishFirstSave?.({ ...component, updatedAt: '2026-08-15T00:00:01.000Z' });
    await firstSave;
    await queuedSave;
    await deletion;

    expect(saveComponent).toHaveBeenCalledOnce();
    expect(deleteComponent).toHaveBeenCalledOnce();
    expect(useAppStore.getState().components).toEqual([]);
  });

  it('does not steal selection when component A finishes saving after the user selects B', async () => {
    let finishSave: ((saved: ComponentRecord) => void) | undefined;
    saveComponent.mockImplementationOnce(
      () => new Promise<ComponentRecord>((resolve) => { finishSave = resolve; }),
    );
    useAppStore.setState({ components: [component, componentB], selectedComponentId: component.id });
    const saving = useAppStore.getState().saveComponent(component);
    await waitFor(() => expect(saveComponent).toHaveBeenCalledOnce());

    useAppStore.getState().setSelectedComponentId(componentB.id);
    finishSave?.({ ...component, updatedAt: '2026-08-15T00:00:01.000Z' });
    await saving;

    expect(useAppStore.getState().selectedComponentId).toBe(componentB.id);
    expect(saveAppSettings).toHaveBeenLastCalledWith({ lastComponentId: componentB.id });
  });
});
