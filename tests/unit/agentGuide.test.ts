// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentGuide, commandCatalog } from '../../src/main/cli/commandRegistry';

describe('agent discovery', () => {
  it('returns every registered command in the live guide', () => {
    expect(agentGuide().commands.map(command => command.name))
      .toEqual(commandCatalog().map(command => command.name));
  });

  it('directs Codex to read the live guide before mutations', () => {
    const skill = readFileSync(resolve('.agents/skills/component-vault-cli/SKILL.md'), 'utf8');
    expect(skill).toContain('agent-guide --format json');
    expect(skill).toContain('ifRevision');
  });
});
