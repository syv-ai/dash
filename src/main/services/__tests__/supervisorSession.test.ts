import { describe, it, expect } from 'vitest';
import {
  buildDispatchArgs,
  parseDispatchOutput,
  isDispatchFailure,
  parseUntrustedRoot,
  parseAgentsJson,
  activityFromSupervisor,
  isUnderDir,
  SESSION_REMOVED_DETAIL,
  SESSION_SLEEPING_DETAIL,
} from '../supervisorSession';

describe('buildDispatchArgs', () => {
  it('always backgrounds with --name, even on resume', () => {
    expect(buildDispatchArgs({ name: 'my task', resumeSessionId: 'abc-123' })).toEqual([
      '--bg',
      '--name',
      'my task',
      '--resume',
      'abc-123',
    ]);
  });

  it('maps permission modes and model, and keeps the prompt last', () => {
    expect(
      buildDispatchArgs({
        name: 't',
        permissionMode: 'acceptEdits',
        model: 'opus',
        ultracode: true,
        prompt: 'do the thing',
      }),
    ).toEqual([
      '--bg',
      '--name',
      't',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'opus',
      '--settings',
      '{"ultracode":true}',
      '--',
      'do the thing',
    ]);
    expect(buildDispatchArgs({ name: 't', permissionMode: 'bypassPermissions' })).toContain(
      '--dangerously-skip-permissions',
    );
    expect(buildDispatchArgs({ name: 't', model: 'default' })).not.toContain('--model');
  });

  it('ends the options with -- so a prompt starting with "-" stays the prompt', () => {
    const args = buildDispatchArgs({ name: 't', resumeSessionId: 's', prompt: '- fix the bug' });
    expect(args.slice(-2)).toEqual(['--', '- fix the bug']);
    expect(buildDispatchArgs({ name: 't' })).not.toContain('--');
  });

  it('puts --mcp-config right after --bg so --name closes the variadic flag', () => {
    const args = buildDispatchArgs({
      name: 't',
      mcpConfigPath: '/u/control/mcp-config/abc.json',
      permissionMode: 'acceptEdits',
      model: 'opus',
      resumeSessionId: 'sess',
      prompt: 'do the thing',
    });
    expect(args.slice(0, 3)).toEqual(['--bg', '--mcp-config', '/u/control/mcp-config/abc.json']);
    // --mcp-config is variadic: whatever follows its path must be a flag, never
    // the prompt, or the CLI reads the prompt as a second config file.
    expect(args[args.indexOf('/u/control/mcp-config/abc.json') + 1]).toBe('--name');
    expect(args[args.length - 1]).toBe('do the thing');
  });

  it('merges ultracode and the allow list into one --settings', () => {
    const args = buildDispatchArgs({
      name: 't',
      ultracode: true,
      mcpConfigPath: '/u/c.json',
      allowTools: ['mcp__dash__tasks_list', 'mcp__dash__tasks_get'],
      prompt: 'p',
    });
    expect(args.filter((a) => a === '--settings')).toHaveLength(1);
    expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toEqual({
      ultracode: true,
      permissions: { allow: ['mcp__dash__tasks_list', 'mcp__dash__tasks_get'] },
    });
    expect(args[args.length - 1]).toBe('p');
  });

  it('passes the allow list alone without ultracode, and no --settings with neither', () => {
    const args = buildDispatchArgs({ name: 't', allowTools: ['mcp__dash__tasks_list'] });
    expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toEqual({
      permissions: { allow: ['mcp__dash__tasks_list'] },
    });
    expect(buildDispatchArgs({ name: 't', allowTools: [] })).not.toContain('--settings');
  });

  it('passes no --mcp-config without a path', () => {
    expect(buildDispatchArgs({ name: 't', prompt: 'p' })).not.toContain('--mcp-config');
  });
});

describe('parseDispatchOutput', () => {
  it('extracts the short job id from the backgrounded line', () => {
    const out =
      'backgrounded · 5ebbd6cc · my task\n\n  claude attach 5ebbd6cc\n  claude logs 5ebbd6cc\n';
    expect(parseDispatchOutput(out)).toBe('5ebbd6cc');
  });

  it('ignores ANSI colour codes and leading noise', () => {
    expect(parseDispatchOutput('warning: x\n\x1b[2mbackgrounded\x1b[0m · deadbeef · t')).toBe(
      'deadbeef',
    );
  });

  it('reads the job id of a woken session and of a copy', () => {
    const woke =
      'note: woke session 7ec72810 with its saved options (--mcp-config, --name).\nbackgrounded · 7ec72810 · t\n';
    expect(parseDispatchOutput(woke)).toBe('7ec72810');
    const copy =
      'note: session 7ec72810 is already running in the background, so this started a copy as 73a3165a.\nbackgrounded · 73a3165a\n';
    expect(parseDispatchOutput(copy)).toBe('73a3165a');
  });

  it('returns null when the line is missing', () => {
    expect(parseDispatchOutput("Couldn't start a background session")).toBeNull();
    expect(isDispatchFailure("Couldn't start a background session: no such dir")).toBe(true);
    expect(isDispatchFailure('backgrounded · 5ebbd6cc · t')).toBe(false);
  });
});

describe('parseAgentsJson', () => {
  it('parses background and interactive rows with missing optional fields', () => {
    const rows = parseAgentsJson(
      JSON.stringify([
        {
          id: '5ebbd6cc',
          sessionId: '5ebbd6cc-43bd-4b1e-9c2f-0000',
          name: 'task-a',
          cwd: '/repo/.claude/worktrees/task-a',
          kind: 'background',
          startedAt: 1,
          state: 'blocked',
          status: 'idle',
          pid: 42,
          extra: { ignored: true },
        },
        { cwd: '/repo', kind: 'interactive', startedAt: 2, status: 'busy', pid: 7 },
        { nope: true },
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: '5ebbd6cc', kind: 'background', state: 'blocked' });
    expect(rows[1]).toMatchObject({ kind: 'interactive', status: 'busy' });
    expect(rows[1]!.id).toBeUndefined();
  });

  it('degrades unknown enum values to undefined and tolerates bad JSON', () => {
    const rows = parseAgentsJson(
      JSON.stringify([{ cwd: '/x', state: 'hibernating', status: 'zzz', startedAt: 0 }]),
    );
    expect(rows[0]!.state).toBeUndefined();
    expect(rows[0]!.status).toBeUndefined();
    expect(parseAgentsJson('not json')).toEqual([]);
    expect(parseAgentsJson('{}')).toEqual([]);
  });
});

describe('activityFromSupervisor', () => {
  const base = { cwd: '/x', kind: 'background' as const, startedAt: 0, id: 'a', pid: 1 };

  it('maps status and state onto Dash activity', () => {
    expect(activityFromSupervisor({ ...base, status: 'busy' }).state).toBe('busy');
    expect(
      activityFromSupervisor({ ...base, status: 'waiting', waitingFor: 'input needed' }),
    ).toEqual({
      state: 'waiting',
      detail: 'input needed',
    });
    expect(activityFromSupervisor({ ...base, status: 'idle', state: 'done' }).state).toBe('idle');
    expect(activityFromSupervisor({ ...base, state: 'failed', detail: 'boom' })).toEqual({
      state: 'error',
      error: { type: 'supervisor', message: 'boom' },
    });
  });

  it('treats stopped, pid-less and missing jobs as stopped with a reason', () => {
    expect(activityFromSupervisor({ ...base, state: 'stopped' })).toEqual({
      state: 'stopped',
      detail: SESSION_SLEEPING_DETAIL,
    });
    expect(activityFromSupervisor({ ...base, pid: undefined, state: 'done' }).state).toBe(
      'stopped',
    );
    expect(activityFromSupervisor(undefined)).toEqual({
      state: 'stopped',
      detail: SESSION_REMOVED_DETAIL,
    });
  });
});

describe('isUnderDir', () => {
  it('matches the dir itself and descendants only', () => {
    expect(isUnderDir('/repo', '/repo')).toBe(true);
    expect(isUnderDir('/repo/.claude/worktrees/t', '/repo/')).toBe(true);
    expect(isUnderDir('/repo-other/x', '/repo')).toBe(false);
    expect(isUnderDir('/re', '/repo')).toBe(false);
  });
});

describe('parseUntrustedRoot', () => {
  it('reads the folder Claude Code wants trusted from the --bg refusal', () => {
    expect(
      parseUntrustedRoot(
        'Workspace not trusted. Run `claude` in /Users/me/repos/dffd once and accept the trust prompt, then retry.\n',
      ),
    ).toBe('/Users/me/repos/dffd');
  });

  it('keeps spaces in the path and ignores colour codes', () => {
    expect(
      parseUntrustedRoot(
        '\x1b[31mWorkspace not trusted. Run `claude` in /Users/me/My Repos/app once and accept\x1b[0m',
      ),
    ).toBe('/Users/me/My Repos/app');
  });

  it('is null for any other failure', () => {
    expect(parseUntrustedRoot("couldn't start a background session")).toBeNull();
  });
});
