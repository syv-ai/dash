import { describe, it, expect } from 'vitest';
import { extraArgFlagNames, flagName, flagNoteText, validateExtraArgs } from '../extraArgs';

describe('flagName', () => {
  it('maps aliases and --flag=value to the long name', () => {
    expect(flagName('-n')).toBe('--name');
    expect(flagName('-r')).toBe('--resume');
    expect(flagName('--background')).toBe('--bg');
    expect(flagName('--rc')).toBe('--remote-control');
    expect(flagName('--allowed-tools')).toBe('--allowedTools');
    expect(flagName('--model=opus')).toBe('--model');
    expect(flagName('--chrome')).toBe('--chrome');
  });

  it('treats anything else as a value', () => {
    expect(flagName('opus')).toBeNull();
    expect(flagName('/tmp/x')).toBeNull();
    expect(flagName('-1')).toBeNull();
    expect(flagName('--')).toBeNull();
    expect(flagName('- bullet')).toBeNull();
  });
});

describe('validateExtraArgs', () => {
  it('passes nothing for an empty or missing line', () => {
    for (const input of ['', '   ', null, undefined]) {
      expect(validateExtraArgs(input)).toEqual({ ok: true, args: [], blocked: [], risky: [] });
    }
  });

  it('passes harmless flags as typed, values and = forms included', () => {
    expect(validateExtraArgs(`--chrome --add-dir /a '/b c' --debug=api`)).toEqual({
      ok: true,
      args: ['--chrome', '--add-dir', '/a', '/b c', '--debug=api'],
      blocked: [],
      risky: [],
    });
  });

  it('blocks the flags Dash owns, named as typed, with the picker to use', () => {
    const r = validateExtraArgs('--model=opus -n x --permission-mode plan --chrome');
    expect(r.ok).toBe(false);
    expect(r.args).toEqual([]);
    expect(r.blocked.map((b) => [b.flag, b.name, b.route])).toEqual([
      ['--model', '--model', 'model'],
      ['-n', '--name', undefined],
      ['--permission-mode', '--permission-mode', 'permissions'],
    ]);
    expect(flagNoteText(r.blocked[0]!)).toBe(
      "--model is set by the task's Model picker; use that instead.",
    );
  });

  it('routes the permission bypass flags to the Permissions picker', () => {
    for (const flag of ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions']) {
      expect(validateExtraArgs(flag).blocked[0]?.route).toBe('permissions');
    }
  });

  it('blocks what would blind Dash or leave the background session', () => {
    for (const flag of [
      '--settings x.json',
      '--setting-sources user',
      '--bare',
      '--safe-mode',
      '--restricted',
      '--background',
      '-r abc',
      '-c',
      '--session-id x',
      '-w',
      '--rc',
      '--cloud',
      '-p',
      '--output-format json',
      '--max-turns 3',
      '-v',
      '--effort high',
      '--agent x',
    ]) {
      const r = validateExtraArgs(flag);
      expect(r.ok, flag).toBe(false);
      expect(r.blocked, flag).toHaveLength(1);
    }
  });

  it('allows risky flags with a warning', () => {
    const r = validateExtraArgs(
      `--allowed-tools 'Bash(git:*)' --tools Read --mcp-config m.json --system-prompt x`,
    );
    expect(r.ok).toBe(true);
    expect(r.args).toHaveLength(8);
    expect(r.risky.map((n) => n.name)).toEqual([
      '--allowedTools',
      '--tools',
      '--mcp-config',
      '--system-prompt',
    ]);
  });

  it('reports a flag once, however often it is typed', () => {
    expect(validateExtraArgs('--model a --model b').blocked).toHaveLength(1);
  });

  it('refuses a first word that would become the prompt', () => {
    expect(validateExtraArgs('fix the bug').error).toMatch(/Start with a flag: "fix"/);
  });

  it('refuses a bare -- and combined short flags', () => {
    expect(validateExtraArgs('--chrome -- hi').error).toMatch(/bare --/);
    expect(validateExtraArgs('-pc').error).toBe(
      '-pc combines short flags; write each on its own (-p -c).',
    );
  });

  it("passes a split error through as the reason it can't be read", () => {
    const r = validateExtraArgs('--add-dir $HOME');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/isn't expanded/);
  });
});

describe('extraArgFlagNames', () => {
  it('keeps flag names only, never values, sorted and unique', () => {
    expect(extraArgFlagNames(['--chrome', '--add-dir', '/secret/path', '-d', '--chrome'])).toEqual([
      '--add-dir',
      '--chrome',
      '--debug',
    ]);
  });
});
