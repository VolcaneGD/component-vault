export const CLI_PROTOCOL_VERSION = 1;
export const CLI_MAX_REQUEST_BYTES = 1_000_000;

export type JsonPrimitive = string | number | boolean | null;
// Domain records are intentionally structural TypeScript interfaces without
// index signatures. `object` keeps the protocol boundary usable by those
// records; every inbound object is still validated before dispatch.
export type JsonValue = JsonPrimitive | JsonValue[] | object;

export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonPrimitive[];
  additionalProperties?: boolean;
}

export interface CliRequest {
  protocolVersion: number;
  command: string;
  input?: Record<string, JsonValue>;
}

export type CliSuccess = {
  ok: true;
  result: JsonValue;
};

export type CliFailure = {
  ok: false;
  code: CliFailureCode;
  message: string;
  currentRevision?: number;
};

export type CliResponse = CliSuccess | CliFailure;
export type CliFailureCode = 'usage' | 'not-found' | 'conflict' | 'database-busy' | 'internal-error';

export interface CliCommandDefinition {
  name: string;
  summary: string;
  mutates: boolean;
  revision: 'none' | 'component' | 'library';
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  execute: (input: Record<string, JsonValue>) => Promise<JsonValue> | JsonValue;
}

export class CliUsageError extends Error {
  readonly code = 'usage';
}

export class CliNotFoundError extends Error {
  readonly code = 'not-found';
}

export const toCliFailure = (error: unknown): CliFailure => {
  const coded = error as { code?: unknown; currentRevision?: unknown; message?: unknown } | null;
  if (coded?.code === 'conflict' && typeof coded.currentRevision === 'number') {
    return {
      ok: false,
      code: 'conflict',
      message: 'The record changed; read it again before writing.',
      currentRevision: coded.currentRevision,
    };
  }
  if (coded?.code === 'database-busy') {
    return { ok: false, code: 'database-busy', message: 'Component Vault is busy. Retry shortly.' };
  }
  if (error instanceof CliUsageError || coded?.code === 'usage') {
    return { ok: false, code: 'usage', message: boundedMessage(
      typeof coded?.message === 'string' ? coded.message : error instanceof Error ? error.message : '',
      'Invalid command input.',
    ) };
  }
  if (error instanceof CliNotFoundError || coded?.code === 'not-found') {
    return { ok: false, code: 'not-found', message: boundedMessage(
      typeof coded?.message === 'string' ? coded.message : error instanceof Error ? error.message : '',
      'Requested record was not found.',
    ) };
  }
  return { ok: false, code: 'internal-error', message: 'Unable to complete the command.' };
};

export const executeCommand = async (
  registry: readonly CliCommandDefinition[],
  request: CliRequest,
): Promise<CliResponse> => {
  try {
    if (request.protocolVersion !== CLI_PROTOCOL_VERSION) {
      throw new CliUsageError(`Unsupported protocol version: ${String(request.protocolVersion)}`);
    }
    if (typeof request.command !== 'string' || request.command.length === 0 || request.command.length > 100) {
      throw new CliUsageError('A valid command is required.');
    }
    if (request.input !== undefined && !isRecord(request.input)) throw new CliUsageError('Command input must be an object.');
    const command = registry.find(item => item.name === request.command);
    if (!command) throw new CliUsageError(`Unknown command: ${request.command}`);
    return { ok: true, result: await command.execute(request.input ?? {}) };
  } catch (error) {
    return toCliFailure(error);
  }
};

export const isRecord = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedMessage = (message: string, fallback: string): string =>
  (message.trim() || fallback).slice(0, 512);
