import { describe, it, expect } from 'vitest';
import { callerString, parseCaller } from '../callers';

describe('callers', () => {
  it('round-trips both caller kinds', () => {
    expect(parseCaller('orchestrator')).toEqual({ kind: 'orchestrator' });
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(parseCaller(`task:${id}`)).toEqual({ kind: 'task', taskId: id });
    expect(callerString({ kind: 'task', taskId: id })).toBe(`task:${id}`);
    expect(callerString({ kind: 'orchestrator' })).toBe('orchestrator');
  });

  it('rejects anything else', () => {
    for (const h of [undefined, '', 'task:', 'Orchestrator', 'task:a b', 'task:../x', 'user']) {
      expect(parseCaller(h)).toBeNull();
    }
  });
});
