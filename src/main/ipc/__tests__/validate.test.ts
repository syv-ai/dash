import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { parseArgs, parseArgsSafe } from '../validate';
import { projectInputSchema, taskInputSchema, permissionModeSchema } from '../schemas';

describe('parseArgs', () => {
  it('returns the typed value on a valid payload', () => {
    const out = parseArgs('test:channel', z.tuple([z.string()]), ['hello']);
    expect(out).toEqual(['hello']);
  });

  it('throws with a channel-tagged, readable message on invalid input', () => {
    expect(() => parseArgs('db:deleteProject', z.tuple([z.string()]), [42])).toThrow(
      /Invalid IPC arguments for db:deleteProject/,
    );
  });

  it('includes the offending path in the message', () => {
    const schema = z.object({ id: z.string() });
    expect(() => parseArgs('x', schema, { id: 1 })).toThrow(/id:/);
  });
});

describe('parseArgsSafe', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the value on valid input', () => {
    expect(parseArgsSafe('pty:kill', z.string(), 'abc')).toBe('abc');
  });

  it('returns undefined and logs on invalid input (no throw)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseArgsSafe('pty:kill', z.string(), 123)).toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('dropping pty:kill'));
  });
});

describe('domain schemas', () => {
  it('projectInputSchema requires name and path', () => {
    expect(projectInputSchema.safeParse({ name: 'p', path: '/p' }).success).toBe(true);
    expect(projectInputSchema.safeParse({ name: 'p' }).success).toBe(false);
  });

  it('projectInputSchema passes through unknown keys (no silent drop)', () => {
    const parsed = projectInputSchema.parse({ name: 'p', path: '/p', futureField: 'keep' });
    expect((parsed as Record<string, unknown>).futureField).toBe('keep');
  });

  it('taskInputSchema requires projectId, name, branch, path', () => {
    expect(
      taskInputSchema.safeParse({ projectId: 'a', name: 'n', branch: 'b', path: '/p' }).success,
    ).toBe(true);
    expect(taskInputSchema.safeParse({ name: 'n' }).success).toBe(false);
  });

  it('taskInputSchema rejects an invalid permissionMode', () => {
    const bad = taskInputSchema.safeParse({
      projectId: 'a',
      name: 'n',
      branch: 'b',
      path: '/p',
      permissionMode: 'nope',
    });
    expect(bad.success).toBe(false);
  });

  it('permissionModeSchema accepts the three valid modes', () => {
    for (const m of ['default', 'acceptEdits', 'bypassPermissions']) {
      expect(permissionModeSchema.safeParse(m).success).toBe(true);
    }
  });
});
