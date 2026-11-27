import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('no app');
    },
  },
}));

import { limitEventLine, scrubPayload } from '../limitEventLog';

describe('scrubPayload', () => {
  it('drops path and session fields and writes the home folder as ~', () => {
    expect(
      scrubPayload(
        {
          session_id: 's',
          transcript_path: '/Users/me/.claude/projects/x.jsonl',
          cwd: '/Users/me/repo',
          hook_event_name: 'StopFailure',
          error: 'rate_limit',
          error_details: 'see /Users/me/log',
        },
        '/Users/me',
      ),
    ).toEqual({ hook_event_name: 'StopFailure', error: 'rate_limit', error_details: 'see ~/log' });
  });

  it('caps long strings and deep nesting', () => {
    const out = scrubPayload({ m: 'x'.repeat(1000), a: { b: { c: { d: 1 } } } }, '') as Record<
      string,
      unknown
    >;
    expect((out.m as string).length).toBe(401);
    expect(out.a).toEqual({ b: { c: '[…]' } });
  });
});

describe('limitEventLine', () => {
  it('is one JSON line with the event, version, limits and scrubbed payload', () => {
    const line = limitEventLine(
      {
        event: 'StopFailure',
        payload: { cwd: '/x', error: 'rate_limit' },
        claudeVersion: '2.1.332',
        rateLimits: { fiveHour: { usedPercentage: 97, resetsAt: 1 } },
      },
      new Date('2026-11-28T00:00:00Z'),
      '',
    );
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      at: '2026-11-28T00:00:00.000Z',
      event: 'StopFailure',
      claudeVersion: '2.1.332',
      rateLimits: { fiveHour: { usedPercentage: 97, resetsAt: 1 } },
      payload: { error: 'rate_limit' },
    });
  });
});
