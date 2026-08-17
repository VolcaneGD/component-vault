import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const editorTabs = readFileSync('src/renderer/src/features/editor/EditorTabs.tsx', 'utf8');
const appStyles = readFileSync('src/renderer/src/app.css', 'utf8');

describe('Component Vault Monaco theme', () => {
  it('defines a high-contrast editor scrollbar handle for its dark canvas', () => {
    expect(editorTabs).toMatch(/'scrollbarSlider\.background': '#AFA5FF'/);
    expect(editorTabs).toMatch(/'scrollbarSlider\.hoverBackground': '#CFC9FF'/);
    expect(editorTabs).toMatch(/'scrollbarSlider\.activeBackground': '#FFFFFF'/);
  });

  it('applies the visible scrollbar colors directly to Monaco slider elements', () => {
    expect(appStyles).toMatch(/\.monaco-editor \.monaco-scrollable-element > \.scrollbar > \.slider \{[^}]*background: #AFA5FF !important;/);
    expect(appStyles).toMatch(/\.monaco-editor \.monaco-scrollable-element > \.scrollbar > \.slider:hover \{[^}]*background: #CFC9FF !important;/);
    expect(appStyles).toMatch(/\.monaco-editor \.monaco-scrollable-element > \.scrollbar > \.slider\.active \{[^}]*background: #FFFFFF !important;/);
  });
});
