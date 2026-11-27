import { describe, it, expect } from 'vitest';
import { commandFromFile, enabledPluginRoots, parseFrontmatter } from '../SlashCommandService';

describe('parseFrontmatter', () => {
  it('reads scalars, quoted values, continued and block scalars', () => {
    const { fields, body } = parseFrontmatter(
      [
        '---',
        'name: fix-issue',
        'description: "Fix a GitHub issue"',
        'argument-hint: [issue-number]',
        'when_to_use: when an issue',
        '  is named',
        'notes: >',
        '  one',
        '  two',
        'allowed-tools:',
        '  - Bash',
        '---',
        '# Body',
      ].join('\n'),
    );
    expect(fields).toMatchObject({
      name: 'fix-issue',
      description: 'Fix a GitHub issue',
      'argument-hint': '[issue-number]',
      when_to_use: 'when an issue is named',
      notes: 'one two',
    });
    expect(body).toBe('# Body');
  });

  it('has none unless --- is the first line', () => {
    expect(parseFrontmatter('\n---\nname: x\n---\n').fields).toEqual({});
  });
});

describe('commandFromFile', () => {
  const skill = { source: 'project', kind: 'skill' } as const;

  it("names a skill by its frontmatter, else its folder; describes it by the body's first line", () => {
    expect(commandFromFile('---\nname: deploy\n---\n', 'dir', skill)?.name).toBe('deploy');
    expect(commandFromFile('\n# Ship it\nmore', 'ship', skill)).toEqual({
      name: 'ship',
      description: 'Ship it',
      source: 'project',
    });
  });

  it("ignores a command file's name field and prefixes a plugin's", () => {
    const cmd = commandFromFile('---\nname: other\nargument-hint: [n]\n---\nGo', 'frontend:x', {
      source: 'plugin',
      kind: 'command',
      prefix: 'tools:',
    });
    expect(cmd).toEqual({
      name: 'tools:frontend:x',
      description: 'Go',
      argumentHint: '[n]',
      source: 'plugin',
    });
  });

  it('leaves out a skill that is not user-invocable', () => {
    expect(commandFromFile('---\nuser-invocable: false\n---\n', 'x', skill)).toBeNull();
  });
});

describe('enabledPluginRoots', () => {
  const installed = {
    'a@m': [{ scope: 'user', installPath: '/c/a' }],
    'b@m': [
      { scope: 'project', installPath: '/c/b-other', projectPath: '/other' },
      { scope: 'project', installPath: '/c/b', projectPath: '/repo' },
    ],
    'c@m': [{ scope: 'project', installPath: '/c/c', projectPath: '/other' }],
    'd@m': [{ scope: 'user', installPath: '/c/d' }],
  };

  it('takes enabled plugins with a user install or one for this project', () => {
    expect(
      enabledPluginRoots(
        installed,
        { 'a@m': true, 'b@m': true, 'c@m': true, 'd@m': false },
        '/repo',
      ),
    ).toEqual([
      ['a', '/c/a'],
      ['b', '/c/b'],
    ]);
  });
});
