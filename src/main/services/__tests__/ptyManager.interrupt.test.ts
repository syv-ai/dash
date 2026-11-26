import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __testReset, __registerForTest, writePty } from '../ptyManager';
import { activityMonitor } from '../ActivityMonitor';

/**
 * Escape in the agent pane is Claude Code's interrupt, and Claude Code fires
 * no hook for it — so the keystroke itself has to bring the activity dot back
 * from "running". Records registered here have no process, so writePty only
 * exercises the signal, not the write.
 */

const ESC = '\x1b';

function busyAgent(id: string, taskId: string): void {
  __registerForTest(id, { kind: 'agent', taskId, featureId: null });
  activityMonitor.register(taskId, 1);
  activityMonitor.setToolStart(taskId, 'Bash', { command: 'sleep 100' });
}

beforeEach(() => __testReset());
afterEach(() => {
  for (const id of Object.keys(activityMonitor.getAll())) activityMonitor.unregister(id);
});

describe('writePty — Escape interrupt', () => {
  it('a bare Escape on the agent pane returns the task to idle', () => {
    busyAgent('t1', 't1');
    writePty('t1', ESC);
    expect(activityMonitor.getAll()['t1']!.state).toBe('idle');
    expect(activityMonitor.getAll()['t1']!.tool).toBeUndefined();
  });

  // Ctrl+C mid-turn cancels it as Esc does, and fires no hook either
  // (S2: before this, the dot stayed amber until the next supervisor poll).
  it('Ctrl+C on the agent pane returns the task to idle as an interrupt', () => {
    busyAgent('t1', 't1');
    writePty('t1', '\x03');
    expect(activityMonitor.getAll()['t1']!.state).toBe('idle');
    expect(activityMonitor.getAll()['t1']!.interrupted).toBe(true);
  });

  it('a CSI sequence that merely starts with Escape (arrow key) is not an interrupt', () => {
    busyAgent('t1', 't1');
    writePty('t1', `${ESC}[A`);
    expect(activityMonitor.getAll()['t1']!.state).toBe('busy');
  });

  it('Escape typed into a shell or side-car TUI leaves the task alone', () => {
    busyAgent('t1', 't1');
    __registerForTest('shell:t1', { kind: 'shell', taskId: 't1', featureId: null });
    __registerForTest('ports-tui:t1', { kind: 'tui', taskId: 't1', featureId: 'ports' });
    writePty('shell:t1', ESC);
    writePty('ports-tui:t1', ESC);
    expect(activityMonitor.getAll()['t1']!.state).toBe('busy');
  });

  it('ignores an unknown PTY id', () => {
    expect(() => writePty('nope', ESC)).not.toThrow();
  });
});
