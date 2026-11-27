import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  agentFromFile,
  commandFromFile,
  enabledPluginRoots,
  listAgents,
  parseFrontmatter,
} from '../SlashCommandService';

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

describe('agentFromFile', () => {
  it('needs a frontmatter name for a user or project agent, without a colon', () => {
    expect(
      agentFromFile('---\nname: reviewer\ndescription: Reviews code\n---\nYou review.', 'x', {
        source: 'project',
      }),
    ).toEqual({ name: 'reviewer', description: 'Reviews code', source: 'project' });
    expect(agentFromFile('# Notes about agents', 'README', { source: 'user' })).toBeNull();
    expect(agentFromFile('---\nname: a:b\n---\n', 'x', { source: 'user' })).toBeNull();
  });

  it("scopes a plugin's agent by plugin and folders, under its file name when unnamed", () => {
    expect(
      agentFromFile('---\nname: security\n---\n', 'sec', {
        source: 'plugin',
        scope: ['my-plugin', 'review'],
      })?.name,
    ).toBe('my-plugin:review:security');
    expect(agentFromFile('no frontmatter', 'helper', { source: 'plugin', scope: ['p'] })).toEqual({
      name: 'p:helper',
      description: '',
      source: 'plugin',
    });
  });
});

describe('listAgents', () => {
  const env = {
    config: process.env.CLAUDE_CONFIG_DIR,
    plugins: process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR,
  };
  const dirs: string[] = [];
  afterEach(() => {
    process.env.CLAUDE_CONFIG_DIR = env.config;
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = env.plugins;
    if (env.config === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    if (env.plugins === undefined) delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const agent = (name: string, description: string) =>
    `---\nname: ${name}\ndescription: ${description}\n---\nPrompt.`;

  it('lists project, user and enabled plugin agents, folders included, the project winning a clash', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-agents-'));
    dirs.push(root);
    const user = path.join(root, 'user');
    const repo = path.join(root, 'repo');
    const plugins = path.join(root, 'plugins');
    process.env.CLAUDE_CONFIG_DIR = user;
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = plugins;
    write(path.join(repo, '.claude/agents/review/reviewer.md'), agent('reviewer', 'Project one'));
    write(path.join(user, 'agents/reviewer.md'), agent('reviewer', 'User one'));
    write(path.join(user, 'agents/writer.md'), agent('writer', 'Writes'));
    write(path.join(user, 'agents/README.md'), '# Notes');
    write(path.join(plugins, 'p/1/agents/deep/scan.md'), agent('scan', 'Scans'));
    write(path.join(plugins, 'p/1/skills/x/subagents/auditor.md'), agent('auditor', 'Audits'));
    write(
      path.join(plugins, 'p/1/.claude-plugin/plugin.json'),
      JSON.stringify({ agents: ['./skills/x/subagents/auditor.md', '../../outside.md'] }),
    );
    write(
      path.join(plugins, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: { 'p@m': [{ scope: 'user', installPath: path.join(plugins, 'p/1') }] },
      }),
    );
    write(path.join(user, 'settings.json'), JSON.stringify({ enabledPlugins: { 'p@m': true } }));

    expect(await listAgents(repo)).toEqual([
      { name: 'p:auditor', description: 'Audits', source: 'plugin' },
      { name: 'p:deep:scan', description: 'Scans', source: 'plugin' },
      { name: 'reviewer', description: 'Project one', source: 'project' },
      { name: 'writer', description: 'Writes', source: 'user' },
    ]);
  });
});
