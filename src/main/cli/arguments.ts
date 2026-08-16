import { CLI_PROTOCOL_VERSION, type CliRequest, type JsonValue, isRecord } from '../../shared/cliProtocol';

export interface ParsedCliArguments {
  command: string;
  request: CliRequest;
}

export const parseCliArguments = (argv: string[]): ParsedCliArguments => {
  // Electron keeps its own startup switches in process.argv. They control the
  // runtime (for example an isolated --user-data-dir) rather than the command.
  const filtered = argv.filter(argument => argument !== '--cli' && !argument.startsWith('--user-data-dir='));
  if (filtered[0] === 'schema') {
    const target = filtered.slice(1).filter(argument => argument !== '--json').join(' ');
    if (!target) throw new Error('schema requires a command name.');
    return { command: 'schema', request: { protocolVersion: CLI_PROTOCOL_VERSION, command: 'schema', input: { command: target } } };
  }
  if (filtered[0] === 'agent-guide') {
    const formatIndex = filtered.indexOf('--format');
    const format = formatIndex === -1 ? 'json' : filtered[formatIndex + 1];
    if (format !== 'json' && format !== 'markdown') throw new Error('agent-guide format must be json or markdown.');
    return { command: 'agent-guide', request: { protocolVersion: CLI_PROTOCOL_VERSION, command: 'agent-guide', input: { format } } };
  }
  const commandLength = filtered[0] === 'library' || filtered[0] === 'component' ? 2 : 1;
  const commandTokens = filtered.slice(0, commandLength);
  if (commandTokens.length !== commandLength || commandTokens.some(token => token.startsWith('-'))) {
    throw new Error('A command is required. Use agent-guide after installation.');
  }
  const command = commandTokens.join(' ');
  const options = filtered.slice(commandLength);
  let input: Record<string, JsonValue> = {};
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === '--json') continue;
    if (option === '--input-json') {
      const source = options[index + 1];
      if (source === undefined) throw new Error('input-json requires a JSON object.');
      index += 1;
      try {
        const parsed = JSON.parse(source) as unknown;
        if (!isRecord(parsed)) throw new Error('input-json must be a JSON object.');
        input = parsed;
      } catch (error) {
        if (error instanceof Error && error.message === 'input-json must be a JSON object.') throw error;
        throw new Error('input-json must be a JSON object.');
      }
      continue;
    }
    throw new Error(`Unknown CLI option: ${option}`);
  }
  return {
    command,
    request: { protocolVersion: CLI_PROTOCOL_VERSION, command, ...(Object.keys(input).length === 0 ? {} : { input }) },
  };
};
