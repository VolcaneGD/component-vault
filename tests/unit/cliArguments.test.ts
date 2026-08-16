import { describe, expect, it } from 'vitest';
import { parseCliArguments } from '../../src/main/cli/arguments';
import { runCli } from '../../src/main/cli/entrypoint';

describe('CLI argument parser', () => {
  it('turns a JSON component mutation into a versioned request', () => {
    expect(parseCliArguments([
      'component', 'update', '--input-json', '{"component":{"id":"a1"},"ifRevision":4}', '--json',
    ])).toEqual({
      command: 'component update',
      request: {
        protocolVersion: 1,
        command: 'component update',
        input: { component: { id: 'a1' }, ifRevision: 4 },
      },
    });
  });

  it('rejects an option without a JSON object rather than guessing a mutation', () => {
    expect(() => parseCliArguments(['component', 'delete', '--input-json', '[]']))
      .toThrow('input-json must be a JSON object');
  });

  it('ignores Electron runtime switches that select an isolated user-data directory', () => {
    expect(parseCliArguments(['library', 'list', '--user-data-dir=C:\\Temp\\vault', '--json']).command)
      .toBe('library list');
  });

  it('parses the live guide and schema discovery commands', () => {
    expect(parseCliArguments(['agent-guide', '--format', 'markdown']).request.input).toEqual({ format: 'markdown' });
    expect(parseCliArguments(['schema', 'component', 'update']).request.input).toEqual({ command: 'component update' });
  });

  it('emits exactly one JSON response from the available local broker', async () => {
    const result = await runCli(['library', 'list', '--json'], {
      userDataPath: 'ignored',
      readBroker: async () => ({ endpoint: 'pipe', token: 'token', protocolVersion: 1 }),
      sendBroker: async () => ({ ok: true, result: [] }),
      runHeadless: async () => ({ ok: false, code: 'internal-error', message: 'must not run' }),
    });

    expect(result).toEqual({ exitCode: 0, stdout: '{"ok":true,"result":[]}\n', stderr: '' });
  });
});
