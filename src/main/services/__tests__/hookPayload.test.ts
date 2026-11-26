import { describe, it, expect } from 'vitest';
import {
  isSelfStartedPrompt,
  isSubagentHook,
  runningSubagentIds,
  stopFailureError,
  subagentId,
  statusLineTaskId,
  WAIT_NOTIFICATIONS,
} from '../hookPayload';

// Notification types per code.claude.com/docs/en/hooks (Claude Code 2.1.332).
describe('WAIT_NOTIFICATIONS', () => {
  it('turns every prompt that waits on the user into needs', () => {
    for (const type of [
      'permission_prompt',
      'elicitation_dialog',
      'elicitation_url_dialog',
      'quota_auto_resume_stale',
    ]) {
      expect(WAIT_NOTIFICATIONS[type], type).toBe('needs');
    }
  });

  it('lifts the wait when an elicitation is answered or completes', () => {
    expect(WAIT_NOTIFICATIONS.elicitation_response).toBe('answered');
    expect(WAIT_NOTIFICATIONS.elicitation_complete).toBe('answered');
  });

  it('keeps idle_prompt as idle', () => {
    expect(WAIT_NOTIFICATIONS.idle_prompt).toBe('idle');
  });

  it('ignores types about other sessions or that ask nothing of the user', () => {
    for (const type of [
      'agent_needs_input',
      'agent_completed',
      'auth_success',
      'auth_storage_failure',
      'quota_auto_resume_fired',
      'quota_auto_resume_disabled',
      'plugin_notification',
    ]) {
      expect(WAIT_NOTIFICATIONS[type], type).toBeUndefined();
    }
  });
});

// StopFailure input per code.claude.com/docs/en/hooks (Claude Code 2.1.332):
// the type is `error`, with optional `error_details` and the rendered text in
// `last_assistant_message`.
describe('stopFailureError', () => {
  it('reads the documented `error` field, not `error_type`', () => {
    expect(
      stopFailureError({
        hook_event_name: 'StopFailure',
        error: 'rate_limit',
        error_details: '429 Too Many Requests',
        last_assistant_message: 'API Error: Rate limit reached',
      }),
    ).toEqual({ type: 'rate_limit' });
  });

  it('keeps every documented error value as its own type', () => {
    for (const error of [
      'authentication_failed',
      'oauth_org_not_allowed',
      'account_on_hold',
      'billing_error',
      'invalid_request',
      'model_not_found',
      'server_error',
      'max_output_tokens',
      'cloud_credential_error',
    ]) {
      expect(stopFailureError({ error }).type).toBe(error);
    }
  });

  it('carries the rendered error text only when the type says nothing', () => {
    expect(
      stopFailureError({
        error: 'unknown',
        error_details: 'socket hang up',
        last_assistant_message: 'API Error: socket hang up',
      }),
    ).toEqual({ type: 'unknown', message: 'API Error: socket hang up' });
    expect(stopFailureError({ error: 'brand_new_value', error_details: 'x' })).toEqual({
      type: 'unknown',
      message: 'x',
    });
    expect(stopFailureError({})).toEqual({ type: 'unknown' });
  });
});

describe('isSubagentHook', () => {
  it('is true when Claude Code tags the hook with an agent_id', () => {
    expect(isSubagentHook({ agent_id: 'ae82aa4f719d76ab8', agent_type: 'general-purpose' })).toBe(
      true,
    );
  });

  it('is false for the main agent, which carries no agent_id', () => {
    expect(isSubagentHook({ session_id: 's', hook_event_name: 'PreToolUse' })).toBe(false);
    expect(isSubagentHook({ agent_id: '' })).toBe(false);
  });
});

describe('statusLineTaskId', () => {
  const tasksByPath: Record<string, string> = {
    '/repo': 'root',
    '/repo/.claude/worktrees/wt': 'wt',
  };
  const lookup = (dir: string) => tasksByPath[dir];

  it("credits a worktree session's report to the worktree task, not the root's ptyId", () => {
    const payload = { workspace: { project_dir: '/repo/.claude/worktrees/wt' }, cwd: '/x' };
    expect(statusLineTaskId('root', payload, lookup)).toBe('wt');
  });

  it('falls back to cwd, then to the URL id', () => {
    expect(statusLineTaskId('root', { cwd: '/repo/.claude/worktrees/wt' }, lookup)).toBe('wt');
    expect(statusLineTaskId('root', { cwd: '/elsewhere' }, lookup)).toBe('root');
    expect(statusLineTaskId('root', {}, lookup)).toBe('root');
  });
});

// Shapes from a live Claude Code 2.1.332 session (S3): a Stop while two
// background subagents ran, and the turn a finished one starts on its own.
const stopWithAgents = {
  hook_event_name: 'Stop',
  background_tasks: [
    { id: 'a812df100a2258567', type: 'subagent', status: 'running', agent_type: 'general-purpose' },
    { id: 'bmffhmy29', type: 'shell', status: 'running', command: 'sleep 25' },
    { id: 'a7fff99bbbb0d23bd', type: 'subagent', status: 'completed', agent_type: 'Explore' },
  ],
};

describe('runningSubagentIds', () => {
  it('lists the background subagents still running, not shells or finished ones', () => {
    expect(runningSubagentIds(stopWithAgents)).toEqual(['a812df100a2258567']);
  });

  it('is an empty list when nothing runs, and unknown when the field is absent', () => {
    expect(runningSubagentIds({ background_tasks: [] })).toEqual([]);
    expect(runningSubagentIds({ hook_event_name: 'Stop' })).toBeUndefined();
  });
});

describe('subagentId', () => {
  it("is a subagent's agent_id", () => {
    expect(subagentId({ agent_id: 'a1', agent_type: 'general-purpose' })).toBe('a1');
  });

  it("skips Claude Code's own internal agents, which carry an empty agent_type", () => {
    expect(subagentId({ agent_id: 'a1', agent_type: '' })).toBeUndefined();
    expect(subagentId({ agent_type: 'Explore' })).toBeUndefined();
  });
});

describe('isSelfStartedPrompt', () => {
  it('is true for the turn a finished background subagent starts with its report', () => {
    expect(
      isSelfStartedPrompt({ prompt: '<task-notification>\n<task-id>a7fff99bbbb0d23bd</task-id>' }),
    ).toBe(true);
  });

  it('is false for a prompt the user typed', () => {
    expect(isSelfStartedPrompt({ prompt: 'Run the tests' })).toBe(false);
    expect(isSelfStartedPrompt({})).toBe(false);
  });
});
