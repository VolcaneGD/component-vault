import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CLI_MAX_REQUEST_BYTES,
  CLI_PROTOCOL_VERSION,
  type CliRequest,
  type CliResponse,
  isRecord,
} from '../../shared/cliProtocol';

const CAPABILITY_FILE = 'cli-broker.json';
const CONNECTION_TIMEOUT_MS = 5_000;

export interface CliBrokerEndpoint {
  protocolVersion: number;
  endpoint: string;
  token: string;
}

export interface CliBroker {
  endpoint: string;
  token: string;
  capabilityPath: string;
  stop: () => Promise<void>;
}

export interface StartCliBrokerOptions {
  userDataPath: string;
  execute: (request: CliRequest) => Promise<CliResponse>;
  isMutation: (command: string) => boolean;
  onMutation?: (request: CliRequest, response: CliResponse) => void;
  endpoint?: string;
}

export const cliBrokerEndpoint = (userDataPath: string): string => {
  const suffix = createHash('sha256').update(userDataPath).digest('hex').slice(0, 32);
  return `\\\\.\\pipe\\component-vault-${suffix}`;
};

export const cliBrokerCapabilityPath = (userDataPath: string): string => join(userDataPath, CAPABILITY_FILE);

export const startCliBroker = async ({
  userDataPath,
  execute,
  isMutation,
  onMutation,
  endpoint = cliBrokerEndpoint(userDataPath),
}: StartCliBrokerOptions): Promise<CliBroker> => {
  const token = randomBytes(32).toString('base64url');
  const capabilityPath = cliBrokerCapabilityPath(userDataPath);
  const server = createServer({ allowHalfOpen: true }, socket => handleConnection(socket, token, execute, isMutation, onMutation));
  await listen(server, endpoint);
  try {
    await writeCapability(capabilityPath, { protocolVersion: CLI_PROTOCOL_VERSION, endpoint, token });
  } catch (error) {
    await close(server);
    throw error;
  }

  return {
    endpoint,
    token,
    capabilityPath,
    stop: async () => {
      await close(server);
      await rm(capabilityPath, { force: true }).catch(() => undefined);
    },
  };
};

const handleConnection = (
  socket: Socket,
  token: string,
  execute: StartCliBrokerOptions['execute'],
  isMutation: StartCliBrokerOptions['isMutation'],
  onMutation: StartCliBrokerOptions['onMutation'],
): void => {
  let bytes = 0;
  const chunks: Buffer[] = [];
  let settled = false;
  socket.setTimeout(CONNECTION_TIMEOUT_MS, () => finish(socket, { ok: false, code: 'usage', message: 'CLI broker request timed out.' }, () => { settled = true; }));
  socket.on('error', () => undefined);
  socket.on('data', (chunk: Buffer) => {
    if (settled) return;
    bytes += chunk.length;
    if (bytes > CLI_MAX_REQUEST_BYTES) {
      settled = true;
      finish(socket, { ok: false, code: 'usage', message: 'CLI broker request is too large.' });
      return;
    }
    chunks.push(chunk);
    const source = Buffer.concat(chunks).toString('utf8');
    if (source.includes('\n')) {
      settled = true;
      void respondToWireRequest(socket, source, token, execute, isMutation, onMutation);
    }
  });
  socket.on('end', async () => {
    if (settled) return;
    settled = true;
    await respondToWireRequest(socket, Buffer.concat(chunks).toString('utf8'), token, execute, isMutation, onMutation);
  });
};

const respondToWireRequest = async (
  socket: Socket,
  source: string,
  token: string,
  execute: StartCliBrokerOptions['execute'],
  isMutation: StartCliBrokerOptions['isMutation'],
  onMutation: StartCliBrokerOptions['onMutation'],
): Promise<void> => {
  const response = await dispatchWireRequest(source, token, execute);
  finish(socket, response);
  if (response.ok && isMutation(responseRequestCommand(source))) {
    const request = parseWireRequest(source)?.request;
    if (request) onMutation?.(request, response);
  }
};

const dispatchWireRequest = async (
  source: string,
  token: string,
  execute: StartCliBrokerOptions['execute'],
): Promise<CliResponse> => {
  const wire = parseWireRequest(source);
  if (!wire || !tokensMatch(wire.token, token)) {
    return { ok: false, code: 'usage', message: 'Invalid CLI broker request.' };
  }
  try {
    return await execute(wire.request);
  } catch {
    return { ok: false, code: 'internal-error', message: 'Unable to complete the command.' };
  }
};

const parseWireRequest = (source: string): { token: string; request: CliRequest } | null => {
  const lines = source.split('\n').filter(line => line.trim().length > 0);
  if (lines.length !== 1) return null;
  try {
    const parsed = JSON.parse(lines[0]) as unknown;
    if (!isRecord(parsed) || typeof parsed.token !== 'string' || !isRecord(parsed.request)) return null;
    const request = parsed.request;
    if (typeof request.protocolVersion !== 'number' || typeof request.command !== 'string') return null;
    if (request.input !== undefined && !isRecord(request.input)) return null;
    return {
      token: parsed.token,
      request: {
        protocolVersion: request.protocolVersion,
        command: request.command,
        ...(request.input === undefined ? {} : { input: request.input }),
      },
    };
  } catch {
    return null;
  }
};

const responseRequestCommand = (source: string): string => parseWireRequest(source)?.request.command ?? '';

const tokensMatch = (candidate: string, expected: string): boolean => {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
};

const finish = (socket: Socket, response: CliResponse, settled?: () => void): void => {
  settled?.();
  if (!socket.destroyed) socket.end(`${JSON.stringify(response)}\n`);
};

const listen = (server: Server, endpoint: string): Promise<void> => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(endpoint, () => {
    server.removeListener('error', reject);
    resolve();
  });
});

const close = (server: Server): Promise<void> => new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
});

const writeCapability = async (path: string, endpoint: CliBrokerEndpoint): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(endpoint)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
};
