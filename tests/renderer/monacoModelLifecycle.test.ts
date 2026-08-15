import { describe, expect, it, vi } from 'vitest';
import { disposeComponentModelsWith } from '../../src/renderer/src/features/editor/monacoModelLifecycle';

describe('Monaco component model lifecycle', () => {
  it('disposes the HTML, CSS, and JavaScript models for one component only', () => {
    const models = new Map([
      ['component-vault://component-1/html.html', { dispose: vi.fn() }],
      ['component-vault://component-1/css.css', { dispose: vi.fn() }],
      ['component-vault://component-1/javascript.js', { dispose: vi.fn() }],
      ['component-vault://component-2/html.html', { dispose: vi.fn() }],
    ]);
    const monaco = {
      Uri: { parse: (value: string) => value },
      editor: { getModel: (uri: string) => models.get(uri) ?? null },
    };

    disposeComponentModelsWith(monaco, 'component-1');

    expect(models.get('component-vault://component-1/html.html')?.dispose).toHaveBeenCalledOnce();
    expect(models.get('component-vault://component-1/css.css')?.dispose).toHaveBeenCalledOnce();
    expect(models.get('component-vault://component-1/javascript.js')?.dispose).toHaveBeenCalledOnce();
    expect(models.get('component-vault://component-2/html.html')?.dispose).not.toHaveBeenCalled();
  });
});
