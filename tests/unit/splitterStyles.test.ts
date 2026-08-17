import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('src/renderer/src/app.css', 'utf8');

describe('dark splitter styles', () => {
  it('keeps both editor splitter handles visibly distinct from the dark rail', () => {
    expect(styles).toMatch(/\.workbench__splitter span \{[^}]*background: #c2baff;/);
    expect(styles).toMatch(/\.studio-splitter span \{[^}]*background: #c2baff;/);
  });
});
