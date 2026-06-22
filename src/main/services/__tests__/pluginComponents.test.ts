import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolvePluginInstallPath,
  listPluginSkills,
  listPluginAgents,
  listPluginCommands,
  listPluginHooks,
  listPluginComponents,
} from '../pluginComponents';

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-pc-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('resolvePluginInstallPath', () => {
  const data = {
    plugins: {
      'syv-skills@syv-skills': [
        { scope: 'project', installPath: '/cache/syv/0.1.0' },
        { scope: 'user', installPath: '/cache/syv/0.1.0' },
      ],
      'noinstall@x': [{ scope: 'user' }],
    },
  };
  it('returns the first record installPath for the id', () => {
    expect(resolvePluginInstallPath(data, 'syv-skills@syv-skills')).toBe('/cache/syv/0.1.0');
  });
  it('returns null for an unknown id', () => {
    expect(resolvePluginInstallPath(data, 'missing@x')).toBeNull();
  });
  it('returns null when no record has an installPath', () => {
    expect(resolvePluginInstallPath(data, 'noinstall@x')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(resolvePluginInstallPath(null, 'a@b')).toBeNull();
    expect(resolvePluginInstallPath({}, 'a@b')).toBeNull();
  });
});

describe('listPluginSkills', () => {
  it('lists skill folders with their SKILL.md description, sorted', () => {
    const root = tmp();
    const mk = (name: string, body: string) => {
      const d = path.join(root, 'skills', name);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'SKILL.md'), body);
    };
    mk('tdd', '---\nname: tdd\ndescription: Red-green.\n---\n');
    mk('brainstorming', '---\nname: brainstorming\ndescription: Explore intent.\n---\n');
    fs.mkdirSync(path.join(root, 'skills', 'no-skill-md'), { recursive: true });
    expect(listPluginSkills(root)).toEqual([
      { name: 'brainstorming', description: 'Explore intent.' },
      { name: 'tdd', description: 'Red-green.' },
    ]);
  });
  it('returns [] when there is no skills dir', () => {
    expect(listPluginSkills(tmp())).toEqual([]);
  });
});

describe('listPluginAgents', () => {
  it('lists agents/*.md by filename with their description, sorted', () => {
    const root = tmp();
    const dir = path.join(root, 'agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'code-simplifier.md'),
      '---\nname: code-simplifier\ndescription: Simplify code.\n---\nbody',
    );
    fs.writeFileSync(path.join(dir, 'auditor.md'), '---\ndescription: Audit.\n---\n');
    fs.writeFileSync(path.join(dir, 'README.txt'), 'ignored');
    expect(listPluginAgents(root)).toEqual([
      { name: 'auditor', description: 'Audit.' },
      { name: 'code-simplifier', description: 'Simplify code.' },
    ]);
  });
  it('returns [] when there is no agents dir', () => {
    expect(listPluginAgents(tmp())).toEqual([]);
  });
});

describe('listPluginCommands', () => {
  it('lists commands recursively by relative path, sorted', () => {
    const root = tmp();
    const dir = path.join(root, 'commands');
    fs.mkdirSync(path.join(dir, 'git'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'review.md'), '---\ndescription: Review.\n---\n');
    fs.writeFileSync(path.join(dir, 'git', 'commit.md'), '---\ndescription: Commit.\n---\n');
    expect(listPluginCommands(root)).toEqual([
      { name: 'git/commit', description: 'Commit.' },
      { name: 'review', description: 'Review.' },
    ]);
  });
  it('returns [] when there is no commands dir', () => {
    expect(listPluginCommands(tmp())).toEqual([]);
  });
});

describe('listPluginHooks', () => {
  it('lists hook event names from hooks/hooks.json, sorted', () => {
    const root = tmp();
    const dir = path.join(root, 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'hooks.json'),
      JSON.stringify({ hooks: { SessionStart: [{}], PreToolUse: [{}, {}] } }),
    );
    expect(listPluginHooks(root)).toEqual([{ name: 'PreToolUse' }, { name: 'SessionStart' }]);
  });
  it('returns [] when there is no hooks.json', () => {
    expect(listPluginHooks(tmp())).toEqual([]);
  });
});

describe('listPluginComponents', () => {
  it('groups skills/agents/commands/hooks for an install path', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, 'agents', 'a.md'), '---\ndescription: A.\n---\n');
    const c = listPluginComponents(root);
    expect(c.skills).toEqual([]);
    expect(c.agents).toEqual([{ name: 'a', description: 'A.' }]);
    expect(c.commands).toEqual([]);
    expect(c.hooks).toEqual([]);
  });
});
