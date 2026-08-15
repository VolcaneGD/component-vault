import { describe, expect, it } from 'vitest';
import { defaultAppSettings, isViewMode } from '../../src/shared/contracts';

describe('shared contracts', () => {
  it('defaults to the approved two-column workbench', () => {
    expect(defaultAppSettings()).toMatchObject({
      viewMode: 'workbench', galleryColumns: 3,
      editorPreviewRatio: 0.55,
    });
  });
  it.each(['workbench', 'gallery', 'studio'])('accepts %s', mode => {
    expect(isViewMode(mode)).toBe(true);
  });
  it('rejects arbitrary view names', () => expect(isViewMode('other')).toBe(false));
});
