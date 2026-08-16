// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startCliBroker } from '../../src/main/cli/broker';
import { CLI_PROTOCOL_VERSION, type CliRequest, type CliResponse } from '../../src/shared/cliProtocol';

const temporaryDirectories: string[] = [];
const brokers: Array<Awaited<ReturnType<typeof startCliBroker>>> = [];

afterEach(async () => {
  await Promise.all(brokers.splice(0).map(broker => broker.stop()));
  temporaryDirectories.splice(0).forEach(directory => rmSync(directory, { force: true, recursive: true }));
});

describe('CLI broker', () => {
  it('accepts an authenticated request and broadcasts successful mutations', async () => {
    const userDataPath = temporaryDirectory();
    const request: CliRequest = { protocolVersion: CLI_PROTOCOL_VERSION, command: 'component create', input: {} };
    const events: CliRequest[] = [];
    const broker = await startCliBroker({
      userDataPath,
      endpoint: pipeName('accept'),
      execute: async () => ({ ok: true, result: { id: 'created' } }),
      isMutation: command => command === 'component create',
      onMutation: event => events.push(event),
    });
    brokers.push(broker);

    await expect(send(broker.endpoint, { token: broker.token, request })).resolves.toEqual({
      ok: true, result: { id: 'created' },
    });
    expect(events).toEqual([request]);
  });

  it('rejects an unauthenticated request before it reaches the dispatcher', async () => {
    const userDataPath = temporaryDirectory();
    let calls = 0;
    const broker = await startCliBroker({
      userDataPath,
      endpoint: pipeName('auth'),
      execute: async () => {
        calls += 1;
        return { ok: true, result: {} };
      },
      isMutation: () => false,
    });
    brokers.push(broker);

    await expect(send(broker.endpoint, {
      token: 'not-the-capability',
      request: { protocolVersion: CLI_PROTOCOL_VERSION, command: 'library list' },
    })).resolves.toMatchObject({ ok: false, code: 'usage' });
    expect(calls).toBe(0);
  });
});

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'component-vault-broker-'));
  temporaryDirectories.push(directory);
  return directory;
};

const pipeName = (suffix: string): string => `\\\\.\\pipe\\component-vault-broker-${process.pid}-${suffix}-${Date.now()}`;

const send = (endpoint: string, payload: object): Promise<CliResponse> => new Promise((resolve, reject) => {
  const socket = connect(endpoint);
  let response = '';
  socket.setEncoding('utf8');
  socket.once('error', reject);
  socket.on('data', chunk => { response += chunk; });
  socket.on('end', () => {
    try {
      resolve(JSON.parse(response) as CliResponse);
    } catch (error) {
      reject(error);
    }
  });
  socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
});
