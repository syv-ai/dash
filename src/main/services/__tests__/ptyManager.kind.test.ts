import { describe, it, expect, beforeEach } from 'vitest';
import { __testReset, __registerForTest, listForTask } from '../ptyManager';

describe('ptyManager.listForTask', () => {
  beforeEach(() => __testReset());

  it('returns all PTYs for a task when no filter is given', () => {
    __registerForTest('t1', { kind: 'agent', taskId: 't1', featureId: null });
    __registerForTest('shell:t1', { kind: 'shell', taskId: 't1', featureId: null });
    __registerForTest('ports-tui:t1', { kind: 'tui', taskId: 't1', featureId: 'ports' });
    expect(listForTask('t1').sort()).toEqual(['ports-tui:t1', 'shell:t1', 't1']);
  });

  it('filters by kinds', () => {
    __registerForTest('t1', { kind: 'agent', taskId: 't1', featureId: null });
    __registerForTest('shell:t1', { kind: 'shell', taskId: 't1', featureId: null });
    __registerForTest('ports-tui:t1', { kind: 'tui', taskId: 't1', featureId: 'ports' });
    expect(listForTask('t1', { kinds: ['agent', 'shell'] }).sort()).toEqual(['shell:t1', 't1']);
    expect(listForTask('t1', { kinds: ['tui'] })).toEqual(['ports-tui:t1']);
  });

  it('filters by featureId', () => {
    __registerForTest('ports-tui:t1', { kind: 'tui', taskId: 't1', featureId: 'ports' });
    __registerForTest('other-tui:t1', { kind: 'tui', taskId: 't1', featureId: 'other' });
    expect(listForTask('t1', { featureId: 'ports' })).toEqual(['ports-tui:t1']);
  });

  it('does not return PTYs for other tasks', () => {
    __registerForTest('t1', { kind: 'agent', taskId: 't1', featureId: null });
    __registerForTest('t2', { kind: 'agent', taskId: 't2', featureId: null });
    expect(listForTask('t1')).toEqual(['t1']);
  });
});
