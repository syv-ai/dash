import { describe, it, expect } from 'vitest';
import { envKeyProblem, envProblems, parseEnvAssignments } from '../taskEnv';
import { launchOptionsProblem } from '../launchOptions';

describe('envKeyProblem', () => {
  it('takes plain keys from either setter', () => {
    expect(envKeyProblem('TEAMWORK_SEAT', 'task')).toBeNull();
    expect(envKeyProblem('AUTHOR_NAME', 'task')).toBeNull();
    expect(envKeyProblem('NODE_OPTIONS', 'person')).toBeNull();
  });

  it('refuses a malformed key', () => {
    for (const key of ['', 'lower', '1ABC', 'A-B', '_X']) {
      expect(envKeyProblem(key, 'person')).toMatch(/isn't a variable name/);
    }
  });

  it.each([
    ['PATH', /set by Dash for every session/],
    ['CLAUDE_CONFIG_DIR', /set by Dash/],
    ['DASH_TOKEN', /Dash's own/],
    ['ANTHROPIC_BASE_URL', /API access and sign-in/],
    ['CLAUDE_CODE_USE_BEDROCK', /overrides Claude Code/],
    ['CLAUDE_ENV_FILE', /before every Bash command/],
    ['GH_TOKEN', /credential/],
    ['AWS_SECRET_ACCESS_KEY', /credential/],
    ['OPENAI_API_KEY', /credential/],
  ])('refuses %s for everyone, saying why', (key, why) => {
    expect(envKeyProblem(key, 'person')).toMatch(why);
    expect(envKeyProblem(key, 'task')).toMatch(why);
  });

  it.each([
    ['NODE_OPTIONS', /load code/],
    ['DYLD_INSERT_LIBRARIES', /load code/],
    ['LD_PRELOAD', /load code/],
    ['BASH_ENV', /what a shell runs/],
    ['ZDOTDIR', /what a shell runs/],
    ['GIT_SSH_COMMAND', /git run/],
    ['GIT_CONFIG_GLOBAL', /git run/],
    ['EDITOR', /other tools run/],
    ['GIT_SEQUENCE_EDITOR', /git run/],
    ['GOFLAGS', /other tools run/],
    ['HTTPS_PROXY', /network traffic/],
    ['NODE_TLS_REJECT_UNAUTHORIZED', /network traffic/],
  ])('refuses %s to a task only', (key, why) => {
    expect(envKeyProblem(key, 'task')).toMatch(why);
    expect(envKeyProblem(key, 'person')).toBeNull();
  });
});

describe('envProblems', () => {
  it('lists each refused key', () => {
    expect(envProblems({ A: '1', EDITOR: 'vim', PATH: '/x' }, 'task').map((p) => p.key)).toEqual([
      'EDITOR',
      'PATH',
    ]);
  });
});

describe('parseEnvAssignments', () => {
  it('reads KEY=VALUE, the value empty or holding =', () => {
    expect(parseEnvAssignments(['A=1', 'B=', 'C=x=y'])).toEqual({
      ok: true,
      env: { A: '1', B: '', C: 'x=y' },
    });
  });

  it("reads a single '' as none", () => {
    expect(parseEnvAssignments([''])).toEqual({ ok: true, env: {} });
  });

  it('refuses a word without a key, and a key given twice', () => {
    expect(parseEnvAssignments(['A'])).toEqual({ ok: false, error: '--env A: write KEY=VALUE' });
    expect(parseEnvAssignments(['=1'])).toMatchObject({ ok: false });
    expect(parseEnvAssignments(['A=1', 'A=2'])).toEqual({
      ok: false,
      error: '--env A given twice',
    });
  });
});

describe('launchOptionsProblem env', () => {
  it("names a key a person can't set under Environment", () => {
    expect(launchOptionsProblem({ env: { DASH_CALLER: 'x' } })).toBe(
      "Environment: DASH_CALLER is Dash's own (dashctl's caller and token).",
    );
    expect(launchOptionsProblem({ env: { NODE_OPTIONS: '--x' } })).toBeNull();
  });
});
