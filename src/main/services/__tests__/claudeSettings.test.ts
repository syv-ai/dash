import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { claudeDefaultPermissionMode, readClaudeSetting } from '../claudeSettings';

let root: string;
let configDir: string;
let project: string;
const original = process.env.CLAUDE_CONFIG_DIR;

function writeSettings(file: string, defaultMode: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ permissions: { defaultMode } }));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-default-mode-'));
  configDir = path.join(root, 'config');
  project = path.join(root, 'project');
  fs.mkdirSync(configDir);
  fs.mkdirSync(project);
  process.env.CLAUDE_CONFIG_DIR = configDir;
});

afterEach(() => {
  if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = original;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('claudeDefaultPermissionMode', () => {
  it('reads the user settings', () => {
    writeSettings(path.join(configDir, 'settings.json'), 'auto');
    expect(claudeDefaultPermissionMode(project)).toBe('auto');
    expect(claudeDefaultPermissionMode()).toBe('auto');
  });

  it('is undefined with no settings, no defaultMode or a broken file', () => {
    expect(claudeDefaultPermissionMode(project)).toBeUndefined();
    fs.writeFileSync(path.join(configDir, 'settings.json'), '{ nope');
    expect(claudeDefaultPermissionMode(project)).toBeUndefined();
  });

  it('lets project settings override user settings, local first', () => {
    writeSettings(path.join(configDir, 'settings.json'), 'auto');
    writeSettings(path.join(project, '.claude', 'settings.json'), 'acceptEdits');
    expect(claudeDefaultPermissionMode(project)).toBe('acceptEdits');
    writeSettings(path.join(project, '.claude', 'settings.local.json'), 'bypassPermissions');
    expect(claudeDefaultPermissionMode(project)).toBe('bypassPermissions');
  });

  it('maps manual to default and has no answer for a mode Dash lacks', () => {
    writeSettings(path.join(configDir, 'settings.json'), 'manual');
    expect(claudeDefaultPermissionMode()).toBe('default');
    writeSettings(path.join(project, '.claude', 'settings.json'), 'plan');
    expect(claudeDefaultPermissionMode(project)).toBeUndefined();
  });
});

describe('readClaudeSetting', () => {
  const commit = (s: { attribution?: { commit?: unknown } }) => s.attribution?.commit;

  it('takes the first file that sets it, an empty string included', () => {
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      JSON.stringify({ attribution: { commit: 'user' } }),
    );
    expect(readClaudeSetting(project, commit)).toBe('user');
    fs.mkdirSync(path.join(project, '.claude'));
    fs.writeFileSync(
      path.join(project, '.claude', 'settings.local.json'),
      JSON.stringify({ attribution: { commit: '' } }),
    );
    expect(readClaudeSetting(project, commit)).toBe('');
  });
});
