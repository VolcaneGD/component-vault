import { describe, expect, it } from 'vitest';
import { commandRegistry } from '../../src/main/cli/commandRegistry';
import { toCliFailure } from '../../src/shared/cliProtocol';
import { ConflictError } from '../../src/main/services/library';

describe('Component Vault CLI protocol', () => {
  it('declares revision input for every existing-record mutation', () => {
    const registry = commandRegistry({} as never);

    for (const command of ['library update', 'library delete', 'component update', 'component delete', 'component reorder']) {
      expect(registry.find(item => item.name === command)?.inputSchema.required).toContain('ifRevision');
    }
  });

  it('returns a bounded JSON conflict envelope', () => {
    expect(toCliFailure(new ConflictError(7))).toEqual({
      ok: false,
      code: 'conflict',
      message: 'The record changed; read it again before writing.',
      currentRevision: 7,
    });
  });

  it('never exposes an unexpected error stack to callers', () => {
    expect(toCliFailure(new Error('x'.repeat(2_000)))).toEqual({
      ok: false,
      code: 'internal-error',
      message: 'Unable to complete the command.',
    });
  });
});
