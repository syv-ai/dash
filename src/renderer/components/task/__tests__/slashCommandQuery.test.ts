import { describe, it, expect } from 'vitest';
import type { SlashCommand } from '../../../../shared/slashCommands';
import { filterSlashCommands, insertSlashCommand, slashCommandAt } from '../slashCommandQuery';

const cmd = (name: string): SlashCommand => ({ name, description: '', source: 'project' });

describe('slashCommandAt', () => {
  it('finds a / that opens the prompt, after leading space too', () => {
    expect(slashCommandAt('/rev', 4)).toEqual({ start: 0, query: 'rev' });
    expect(slashCommandAt('\n  /', 4)).toEqual({ start: 3, query: '' });
  });

  it('finds one stacked after other leading commands', () => {
    expect(slashCommandAt('/write-tests /fix', 17)).toEqual({ start: 13, query: 'fix' });
  });

  it('ignores a / after prose, where Claude Code would not run it', () => {
    expect(slashCommandAt('Please /review', 14)).toBeNull();
    expect(slashCommandAt('see src/x', 9)).toBeNull();
    expect(slashCommandAt('/fix-issue 12 /x', 16)).toBeNull();
  });

  it('reads plugin names with a colon', () => {
    expect(slashCommandAt('/tools:dep', 10)).toEqual({ start: 0, query: 'tools:dep' });
  });
});

describe('filterSlashCommands', () => {
  it('lists prefix matches first, then names containing the query', () => {
    const all = ['tools:deploy', 'deploy', 'review', 'redeploy'].map(cmd);
    expect(filterSlashCommands(all, 'DEP').map((c) => c.name)).toEqual([
      'deploy',
      'tools:deploy',
      'redeploy',
    ]);
  });
});

describe('insertSlashCommand', () => {
  it('replaces the typed name with /name and a space, caret after it', () => {
    expect(insertSlashCommand('/rev', { start: 0, query: 'rev' }, 4, 'review')).toEqual({
      text: '/review ',
      caret: 8,
    });
  });

  it('replaces the whole name when the caret is inside it, keeping what follows', () => {
    const text = '/rev-old 12 and more';
    expect(insertSlashCommand(text, { start: 0, query: 're' }, 3, 'review')).toEqual({
      text: '/review 12 and more',
      caret: 8,
    });
  });
});
