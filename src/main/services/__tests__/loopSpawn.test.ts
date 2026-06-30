import { describe, it, expect } from 'vitest';
import {
  MANAGER_DENY,
  managerDenySettings,
  resolveAgentModel,
  managerWeakerThanWorker,
  workerPermissionForLevel,
  buildLoopSpawn,
} from '../loopSpawn';
import type { LoopConfig } from '@shared/types';

function cfg(over: Partial<LoopConfig>): LoopConfig {
  return { policy: 'ralph', goal: 'g', level: 'L2', ...over };
}

describe('loopSpawn', () => {
  it('manager deny settings block the structured write tools', () => {
    const deny = managerDenySettings().permissions.deny;
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      expect(deny).toContain(tool);
    }
    expect(deny).toContain('Bash(git commit:*)');
    expect(deny).toContain('Bash(git push:*)');
    // Returns a copy, not the shared constant (callers must not mutate it).
    expect(deny).not.toBe(MANAGER_DENY);
  });

  it('manager model mirrors the worker when not set', () => {
    expect(resolveAgentModel('manager', cfg({ worker: { model: 'claude-opus-4-8' } }))).toBe(
      'claude-opus-4-8',
    );
    expect(
      resolveAgentModel('manager', cfg({ worker: { model: 'a' }, manager: { model: 'b' } })),
    ).toBe('b');
    expect(
      resolveAgentModel('worker', cfg({ worker: { model: 'a' }, manager: { model: 'b' } })),
    ).toBe('a');
  });

  it('flags a manager weaker than the worker (anti-pattern)', () => {
    expect(
      managerWeakerThanWorker(
        cfg({ worker: { model: 'claude-opus-4-8' }, manager: { model: 'claude-haiku-4-5' } }),
      ),
    ).toBe(true);
    // Equal tier is fine.
    expect(
      managerWeakerThanWorker(
        cfg({ worker: { model: 'claude-opus-4-8' }, manager: { model: 'claude-opus-4-8' } }),
      ),
    ).toBe(false);
    // Manager stronger is fine.
    expect(
      managerWeakerThanWorker(
        cfg({ worker: { model: 'claude-sonnet-5' }, manager: { model: 'claude-opus-4-8' } }),
      ),
    ).toBe(false);
    // Manager unset → mirrors worker → not weaker.
    expect(managerWeakerThanWorker(cfg({ worker: { model: 'claude-opus-4-8' } }))).toBe(false);
    // Unranked custom ids → no false alarm.
    expect(
      managerWeakerThanWorker(cfg({ worker: { model: 'my-big' }, manager: { model: 'my-small' } })),
    ).toBe(false);
  });

  it('worker permission follows the level, overridable', () => {
    expect(workerPermissionForLevel(cfg({ level: 'L1' }))).toBe('acceptEdits');
    expect(workerPermissionForLevel(cfg({ level: 'L3' }))).toBe('bypassPermissions');
    expect(
      workerPermissionForLevel(cfg({ level: 'L3', worker: { permissionMode: 'acceptEdits' } })),
    ).toBe('acceptEdits');
  });

  it('buildLoopSpawn: manager runs unprompted but write-denied', () => {
    const m = buildLoopSpawn('manager', cfg({ worker: { model: 'claude-opus-4-8' } }));
    expect(m.permissionMode).toBe('bypassPermissions');
    expect(m.extraSettings).toEqual({ permissions: { deny: expect.arrayContaining(['Write']) } });
    expect(m.model).toBe('claude-opus-4-8'); // mirrored from worker
    expect(m.initialPrompt).toContain('LOOP MANAGER');
  });

  it('buildLoopSpawn: worker writes, no deny settings', () => {
    const w = buildLoopSpawn('worker', cfg({ level: 'L2' }));
    expect(w.permissionMode).toBe('acceptEdits');
    expect(w.extraSettings).toBeUndefined();
    expect(w.initialPrompt).toContain('LOOP WORKER');
  });
});
