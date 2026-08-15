import Editor, { type EditorProps } from '@monaco-editor/react';
import './monacoEnvironment';

export const MonacoEditor = (props: EditorProps) => <Editor {...props} />;
