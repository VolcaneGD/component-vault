import { connect } from 'node:net';
import { agentGuide, agentGuideMarkdown, commandCatalog, commandRegistry } from './commandRegistry';
import { OperationLock } from './operationLock';
import { readCliBrokerEndpoint, type CliBrokerEndpoint } from './broker';
import { parseCliArguments } from './arguments';
import { openDatabase } from '../database/database';
import { createLibraryService } from '../services/library';
import { createSettingsService } from '../services/settings';
import {
  executeCommand,
  toCliFailure,
  type CliRequest,
  type CliResponse,
} from '../../shared/cliProtocol';
import { join } from 'node:path';

export interface CliRunResult {
  exitCode: 0 | 1 | 2 | 3 | 4 | 5;
  stdout: string;
  stderr: string;
}

export interface RunCliDependencies {
  userDataPath: string;
  readBroker?: (userDataPath: string) => Promise<CliBrokerEndpoint | null>;
  sendBroker?: (endpoint: CliBrokerEndpoint, request: CliRequest) => Promise<CliResponse>;
  runHeadless?: (userDataPath: string, request: CliRequest) => Promise<CliResponse>;
}

export const runCli = async (argv: string[], dependencies: RunCliDependencies): Promise<CliRunResult> => {
  let request: CliRequest;
  try {
    request = parseCliArguments(argv).request;
  } catch (error) {
    return formatResponse(toCliFailure({ code: 'usage', message: error instanceof Error ? error.message : 'Invalid command.' }));
  }

  if (request.command === 'agent-guide') {
    const format = request.input?.format;
    return formatResponse({ ok: true, result: format === 'markdown' ? { markdown: agentGuideMarkdown() } : agentGuide() });
  }
  if (request.command === 'schema') {
    const name = request.input?.command;
    const command = typeof name === 'string' ? commandCatalog().find(item => item.name === name) : undefined;
    return formatResponse(command
      ? { ok: true, result: { name: command.name, inputSchema: command.inputSchema, outputSchema: command.outputSchema } }
      : { ok: false, code: 'not-found', message: 'Command schema was not found.' });
  }

  const readBroker = dependencies.readBroker ?? readCliBrokerEndpoint;
  const sendBroker = dependencies.sendBroker ?? sendCliBrokerRequest;
  const runHeadless = dependencies.runHeadless ?? executeHeadless;
  try {
    const broker = await readBroker(dependencies.userDataPath);
    const response = broker
      ? await sendBroker(broker, request).catch(() => runHeadless(dependencies.userDataPath, request))
      : await runHeadless(dependencies.userDataPath, request);
    return formatResponse(response);
  } catch (error) {
    return formatResponse(toCliFailure(error));
  }
};

export const sendCliBrokerRequest = (endpoint: CliBrokerEndpoint, request: CliRequest): Promise<CliResponse> => new Promise((resolve, reject) => {
  const socket = connect(endpoint.endpoint);
  let response = '';
  const timeout = setTimeout(() => {
    socket.destroy();
    reject(new Error('CLI broker request timed out.'));
  }, 5_000);
  socket.setEncoding('utf8');
  socket.once('error', error => {
    clearTimeout(timeout);
    reject(error);
  });
  socket.on('data', chunk => {
    response += chunk;
    if (Buffer.byteLength(response, 'utf8') > 1_000_000) {
      socket.destroy();
      clearTimeout(timeout);
      reject(new Error('CLI broker response is too large.'));
    }
  });
  socket.on('end', () => {
    clearTimeout(timeout);
    try {
      resolve(JSON.parse(response) as CliResponse);
    } catch {
      reject(new Error('CLI broker returned invalid JSON.'));
    }
  });
  socket.on('connect', () => socket.write(`${JSON.stringify({ token: endpoint.token, request })}\n`));
});

const executeHeadless = async (userDataPath: string, request: CliRequest): Promise<CliResponse> => {
  const lock = await OperationLock.acquire(userDataPath);
  const database = openDatabase(join(userDataPath, 'component-vault.sqlite'));
  const libraries = createLibraryService(database);
  try {
    libraries.startSession();
    const registry = commandRegistry({ libraries, settings: createSettingsService(database) });
    return await executeCommand(registry, request);
  } finally {
    libraries.markCleanShutdown();
    database.close();
    await lock.release();
  }
};

const formatResponse = (response: CliResponse): CliRunResult => ({
  exitCode: response.ok ? 0 : response.code === 'usage' ? 2 : response.code === 'not-found' ? 3
    : response.code === 'conflict' ? 4 : response.code === 'database-busy' ? 5 : 1,
  stdout: `${JSON.stringify(response)}\n`,
  stderr: '',
});
