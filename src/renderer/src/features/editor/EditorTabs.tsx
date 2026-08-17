import type { BeforeMount, OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  disposeComponentModels,
  MonacoEditor,
  mountComponentModels,
} from './MonacoEditorAdapter';
import { componentModelPath } from './monacoModelLifecycle';
import { useAppStore } from '../../store/useAppStore';
import { t } from '../../i18n';

export type EditorLanguage = 'html' | 'css' | 'javascript';

interface EditorTabsProps {
  componentId: string;
  html: string;
  css: string;
  javascript: string;
  onChange: (language: EditorLanguage, value: string) => void;
  onSave: () => void;
  autoFocusHtml?: boolean;
}

const tabs: ReadonlyArray<{ language: EditorLanguage; label: string }> = [
  { language: 'html', label: 'HTML' },
  { language: 'css', label: 'CSS' },
  { language: 'javascript', label: 'JavaScript' },
];

const componentVaultTheme: Parameters<BeforeMount>[0]['editor']['defineTheme'] extends (
  name: string,
  data: infer Theme,
) => void ? Theme : never = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'tag', foreground: '9B8CFF' },
    { token: 'attribute.name', foreground: '78B5FF' },
    { token: 'string', foreground: '9EE6C3' },
  ],
  colors: {
    'editor.background': '#10172A',
    'editor.foreground': '#EDF1FF',
    'editorLineNumber.foreground': '#65708D',
    'editorLineNumber.activeForeground': '#AEB9D6',
    'editor.selectionBackground': '#51449A99',
    'editor.inactiveSelectionBackground': '#3A356080',
    'editorCursor.foreground': '#B8ADFF',
    'scrollbarSlider.background': '#AFA5FF',
    'scrollbarSlider.hoverBackground': '#CFC9FF',
    'scrollbarSlider.activeBackground': '#FFFFFF',
  },
};

export const EditorTabs = ({
  componentId,
  html,
  css,
  javascript,
  onChange,
  onSave,
  autoFocusHtml = false,
}: EditorTabsProps) => {
  const language = useAppStore((state) => state.settings.language);
  const [activeLanguage, setActiveLanguage] = useState<EditorLanguage>('html');
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const values = { html, css, javascript };
  const activeTab = tabs.find((tab) => tab.language === activeLanguage) ?? tabs[0];

  useEffect(() => {
    mountComponentModels(componentId);
    return () => disposeComponentModels(componentId);
  }, [componentId]);

  useEffect(() => {
    if (autoFocusHtml) setActiveLanguage('html');
  }, [autoFocusHtml, componentId]);

  const configureMonaco = useCallback<BeforeMount>((monaco) => {
    monaco.editor.defineTheme('component-vault-dark', componentVaultTheme);
  }, []);

  const captureEditor = useCallback<OnMount>((editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave());
    if (autoFocusHtml && activeLanguage === 'html') editor.focus();
  }, [activeLanguage, autoFocusHtml, onSave]);

  const formatDocument = useCallback(async () => {
    await editorRef.current?.getAction('editor.action.formatDocument')?.run();
    editorRef.current?.focus();
  }, []);

  const moveTabFocus = useCallback((language: EditorLanguage, key: string) => {
    const currentIndex = tabs.findIndex((tab) => tab.language === language);
    let nextIndex = currentIndex;
    if (key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (key === 'Home') nextIndex = 0;
    else if (key === 'End') nextIndex = tabs.length - 1;
    else return false;
    const nextLanguage = tabs[nextIndex].language;
    setActiveLanguage(nextLanguage);
    document.getElementById(`code-tab-${nextLanguage}`)?.focus();
    return true;
  }, []);

  return (
    <div className="editor-tabs">
      <div className="editor-tabs__bar">
        <div className="editor-tabs__list" role="tablist" aria-label={t(language, 'codeLanguage')}>
          {tabs.map((tab) => (
            <button
              key={tab.language}
              type="button"
              id={`code-tab-${tab.language}`}
              role="tab"
              aria-selected={activeLanguage === tab.language}
              aria-controls="component-code-panel"
              tabIndex={activeLanguage === tab.language ? 0 : -1}
              className="editor-tabs__tab"
              onClick={() => setActiveLanguage(tab.language)}
              onKeyDown={(event) => {
                if (moveTabFocus(tab.language, event.key)) event.preventDefault();
              }}
            >
              <span className={`editor-tabs__language-dot editor-tabs__language-dot--${tab.language}`} aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </div>
        <button type="button" className="editor-tabs__format" onClick={() => void formatDocument()}>
          {t(language, 'format')}
        </button>
      </div>
      <div
        id="component-code-panel"
        className="editor-tabs__panel"
        role="tabpanel"
        aria-labelledby={`code-tab-${activeLanguage}`}
        aria-label={`${activeTab.label} ${t(language, 'source')}`}
      >
        <MonacoEditor
          key={`${componentId}-${activeLanguage}`}
          beforeMount={configureMonaco}
          onMount={captureEditor}
          language={activeLanguage}
          path={componentModelPath(componentId, activeLanguage)}
          value={values[activeLanguage]}
          onChange={(value) => onChange(activeLanguage, value ?? '')}
          theme="component-vault-dark"
          keepCurrentModel
          saveViewState
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            wordWrap: 'on',
            padding: { top: 14, bottom: 14 },
            fontFamily: '"Cascadia Code", Consolas, monospace',
            fontSize: 13,
            lineHeight: 21,
            scrollBeyondLastLine: false,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
};
