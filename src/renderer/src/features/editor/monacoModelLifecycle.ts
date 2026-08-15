import type { EditorLanguage } from './EditorTabs';

const modelExtensions: Record<EditorLanguage, string> = {
  html: 'html',
  css: 'css',
  javascript: 'js',
};

export const componentModelPath = (componentId: string, language: EditorLanguage): string =>
  `component-vault://${componentId}/${language}.${modelExtensions[language]}`;

interface DisposableModel {
  dispose: () => void;
}

interface MonacoModelAccess<Uri> {
  Uri: { parse: (value: string) => Uri };
  editor: { getModel: (uri: Uri) => DisposableModel | null };
}

export const disposeComponentModelsWith = <Uri>(
  monaco: MonacoModelAccess<Uri>,
  componentId: string,
): void => {
  (Object.keys(modelExtensions) as EditorLanguage[]).forEach((language) => {
    const uri = monaco.Uri.parse(componentModelPath(componentId, language));
    monaco.editor.getModel(uri)?.dispose();
  });
};
