import { describe, expect, it } from 'vitest';
import { checkHookPayload, HOOK_SCHEMAS, NOTIFICATION_TYPES } from '../hookSchemas';
import { WAIT_NOTIFICATIONS } from '../../services/hookPayload';
import fixtures from './fixtures/hooks-2.1.332.json';

/** `obj` without `key`. */
function without<T extends object>(obj: T, key: keyof T): Partial<T> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

const base = {
  session_id: 's',
  transcript_path: '/t.jsonl',
  cwd: '/c',
};

/** Shapes from the hooks reference's examples (events the live logs didn't catch). */
const documented: Record<string, unknown>[] = [
  {
    ...base,
    hook_event_name: 'StopFailure',
    error: 'rate_limit',
    error_details: 'x',
    last_assistant_message: 'x',
  },
  // H1, live: a 400 gave no error_details.
  { ...base, hook_event_name: 'StopFailure', error: 'unknown', last_assistant_message: 'x' },
  {
    ...base,
    hook_event_name: 'Elicitation',
    mcp_server_name: 'm',
    message: 'x',
    mode: 'form',
    requested_schema: { type: 'object' },
  },
  {
    ...base,
    hook_event_name: 'Elicitation',
    mcp_server_name: 'm',
    message: 'x',
    mode: 'url',
    url: 'https://e',
  },
  {
    ...base,
    hook_event_name: 'ElicitationResult',
    mcp_server_name: 'm',
    action: 'accept',
    content: { a: 1 },
    mode: 'form',
  },
  { ...base, hook_event_name: 'PreCompact', trigger: 'manual', custom_instructions: null },
  { ...base, hook_event_name: 'PostCompact', trigger: 'auto', compact_summary: 'x' },
  {
    ...base,
    hook_event_name: 'SessionStart',
    source: 'resume',
    model: 'm',
    seconds_since_last_response: 1,
    context_tokens: 1,
    prompt_cache_likely_expired: true,
    estimated_cache_write_usd: 1.1,
  },
  { ...base, hook_event_name: 'SessionStart', source: 'clear' },
  {
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__s__t',
    tool_input: {},
    tool_use_id: 't',
    mcp_server: { name: 's', source: 'plugin' },
  },
  {
    ...base,
    hook_event_name: 'Stop',
    stop_hook_active: true,
    last_assistant_message: 'x',
    background_tasks: [
      { id: 'a', type: 'shell', status: 'running', description: 'd', command: 'c' },
    ],
    session_crons: [{ id: 'c', schedule: '0 9 * * 1-5', recurring: true, prompt: 'p' }],
  },
];

describe('hook schemas against real 2.1.332 payloads', () => {
  const registered = fixtures.payloads.filter((p) => p.hook_event_name in HOOK_SCHEMAS);

  it.each(registered.map((p) => [p.hook_event_name, p] as const))('%s matches', (_name, p) => {
    expect(checkHookPayload(p).findings).toEqual([]);
  });

  it('reports PostToolBatch, which Dash never registers, as an unknown event', () => {
    const batch = fixtures.payloads.find((p) => p.hook_event_name === 'PostToolBatch');
    expect(checkHookPayload(batch)).toEqual({
      source: 'hook',
      findings: [{ kind: 'unknown-event', path: 'hook_event_name', value: 'PostToolBatch' }],
    });
  });
});

describe('hook schemas against the documented shapes', () => {
  it.each(documented.map((p) => [p.hook_event_name, p] as const))('%s matches', (_n, p) => {
    expect(checkHookPayload(p).findings).toEqual([]);
  });

  it('knows every notification type Dash acts on', () => {
    for (const type of Object.keys(WAIT_NOTIFICATIONS)) {
      expect(NOTIFICATION_TYPES).toContain(type);
    }
  });
});

describe('hook drift', () => {
  const stop = { ...base, hook_event_name: 'Stop', stop_hook_active: false };

  it('reports a new field by its path, never its value', () => {
    expect(checkHookPayload({ ...stop, brand_new: 'secret text' })).toEqual({
      source: 'hook:Stop',
      findings: [{ kind: 'unexpected-field', path: 'brand_new' }],
    });
  });

  it('reports a new field inside an array entry once, without an index', () => {
    const task = { id: 'a', type: 'subagent', status: 'running', extra: 1 };
    expect(checkHookPayload({ ...stop, background_tasks: [task, task] }).findings).toEqual([
      { kind: 'unexpected-field', path: 'background_tasks[].extra' },
    ]);
  });

  it('reports a missing required field', () => {
    const rest = without(stop, 'stop_hook_active');
    expect(checkHookPayload(rest).findings).toEqual([
      { kind: 'missing-field', path: 'stop_hook_active' },
    ]);
  });

  it('reports a wrong type', () => {
    expect(checkHookPayload({ ...stop, background_tasks: 'none' }).findings).toEqual([
      { kind: 'wrong-type', path: 'background_tasks' },
    ]);
  });

  it('reports an unknown enum value with the value when it is an identifier', () => {
    const p = {
      ...base,
      hook_event_name: 'Notification',
      message: 'm',
      notification_type: 'agent_waiting',
    };
    expect(checkHookPayload(p).findings).toEqual([
      { kind: 'unknown-enum-value', path: 'notification_type', value: 'agent_waiting' },
    ]);
  });

  it('drops an enum value that could be content', () => {
    const p = {
      ...base,
      hook_event_name: 'StopFailure',
      error: 'API Error: /Users/me/secret failed',
    };
    expect(checkHookPayload(p).findings).toEqual([{ kind: 'unknown-enum-value', path: 'error' }]);
  });

  it('reports a StopFailure that names its error in the old `error_type`', () => {
    const p = { ...base, hook_event_name: 'StopFailure', error_type: 'rate_limit' };
    expect(checkHookPayload(p).findings).toEqual([
      { kind: 'missing-field', path: 'error' },
      { kind: 'unexpected-field', path: 'error_type' },
    ]);
  });

  it('falls back to the endpoint event when the payload names none', () => {
    const rest = without(stop, 'hook_event_name');
    expect(checkHookPayload(rest, '/hook/stop')).toEqual({
      source: 'hook:Stop',
      findings: [{ kind: 'missing-field', path: 'hook_event_name' }],
    });
  });

  it('reports a payload that is not an object', () => {
    expect(checkHookPayload(null, '/hook/stop').findings).toEqual([
      { kind: 'wrong-type', path: '$' },
    ]);
  });
});
