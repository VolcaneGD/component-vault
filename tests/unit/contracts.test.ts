import { describe, expect, it } from 'vitest';
import {
  defaultAppSettings,
  isPreviewPolicy,
  isViewMode,
} from '../../src/shared/contracts';

describe('shared contracts', () => {
  it('defaults to the approved two-column workbench', () => {
    expect(defaultAppSettings()).toMatchObject({
      viewMode: 'workbench', galleryColumns: 3,
      editorPreviewRatio: 0.55,
      language: 'en',
    });
  });
  it.each(['workbench', 'gallery', 'studio'])('accepts %s', mode => {
    expect(isViewMode(mode)).toBe(true);
  });
  it('rejects arbitrary view names', () => expect(isViewMode('other')).toBe(false));

  it('accepts preview policies with an HTTPS origin allowlist', () => {
    expect(isPreviewPolicy({
      allowScripts: true,
      allowForms: false,
      allowPopups: false,
      allowedOrigins: ['https://cdn.example.test'],
    })).toBe(true);
  });

  it.each(['http://example.test', 'https://example.test/path', 'not a URL'])(
    'rejects an invalid preview allowlist origin: %s',
    allowedOrigin => {
      expect(isPreviewPolicy({
        allowScripts: true,
        allowForms: false,
        allowPopups: false,
        allowedOrigins: [allowedOrigin],
      })).toBe(false);
    },
  );
});
