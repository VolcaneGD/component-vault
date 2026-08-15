import Editor, { type EditorProps } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import './monacoEnvironment';
import { disposeComponentModelsWith } from './monacoModelLifecycle';

export const MonacoEditor = (props: EditorProps) => <Editor {...props} />;

const modelLeases = new Map<string, number>();
const pendingDisposals = new Map<string, symbol>();

export const mountComponentModels = (componentId: string): void => {
  modelLeases.set(componentId, (modelLeases.get(componentId) ?? 0) + 1);
  pendingDisposals.delete(componentId);
};

export const disposeComponentModels = (componentId: string): void => {
  const remainingLeases = Math.max(0, (modelLeases.get(componentId) ?? 1) - 1);
  if (remainingLeases > 0) {
    modelLeases.set(componentId, remainingLeases);
    return;
  }
  modelLeases.delete(componentId);
  const disposalToken = Symbol(componentId);
  pendingDisposals.set(componentId, disposalToken);
  queueMicrotask(() => {
    if (pendingDisposals.get(componentId) !== disposalToken || modelLeases.has(componentId)) return;
    pendingDisposals.delete(componentId);
    disposeComponentModelsWith(monaco, componentId);
  });
};
