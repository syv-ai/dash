import { describe, it, expect } from 'vitest';
import { ptyExitFallback } from '../ptyExitFallback';

describe('ptyExitFallback', () => {
  it('respawns a shell for agent tabs', () => {
    expect(ptyExitFallback('task-1', false)).toEqual({ action: 'respawn-shell' });
  });

  it('respawns a shell for shell tabs', () => {
    expect(ptyExitFallback('shell:task-1:2', false)).toEqual({ action: 'respawn-shell' });
  });

  it('shows a Run-again message for dead service run tabs instead of respawning', () => {
    const result = ptyExitFallback('service:task-1:web', true);
    expect(result.action).toBe('message');
    if (result.action === 'message') {
      expect(result.message).toContain('Run in the Ports panel');
    }
  });

  it('shows a close-tab message for dead service logs tabs', () => {
    const result = ptyExitFallback('service:task-1:web:logs', true);
    expect(result.action).toBe('message');
    if (result.action === 'message') {
      expect(result.message).not.toContain('Run in the Ports panel');
    }
  });

  it('shows a close-tab message for dead tui tabs', () => {
    const result = ptyExitFallback('tui:ports:task-1', true);
    expect(result.action).toBe('message');
    if (result.action === 'message') {
      expect(result.message).not.toContain('Run in the Ports panel');
    }
  });

  it('stays silent for managed loop panes so the controller can respawn', () => {
    // Loop worker: agent-shaped id (isTui false) that would otherwise respawn a
    // shell — managedExternally must suppress that and emit no exit block.
    const result = ptyExitFallback('loop:task-1', false, true);
    expect(result).toEqual({ action: 'message', message: '' });
  });

  it('managedExternally wins over the shell-respawn default', () => {
    expect(ptyExitFallback('mgr:task-1', false, true).action).toBe('message');
  });
});
