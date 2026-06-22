import os from 'os';
import path from 'path';
import type { ExtensionScopeRef, ExtensionScopeInput } from '@shared/types';

/** Global → Project(s) → Task(s), in inheritance order. */
export function enumerateScopes(input: ExtensionScopeInput): ExtensionScopeRef[] {
  const scopes: ExtensionScopeRef[] = [
    { id: 'global', kind: 'global', name: 'Global', path: os.homedir() },
  ];
  for (const p of input.projects) {
    scopes.push({ id: `project:${p.id}`, kind: 'project', name: p.name, path: p.path });
  }
  for (const t of input.tasks) {
    scopes.push({
      id: `task:${t.taskId}`,
      kind: 'task',
      name: t.name,
      path: t.worktreePath,
      projectId: t.projectId,
    });
  }
  return scopes;
}

/** Where this scope's settings live. Project = committed settings.json (shared);
 *  Task = settings.local.json (worktree-local, not shared); Global = user settings. */
export function settingsFilePath(scope: ExtensionScopeRef): string {
  const file = scope.kind === 'task' ? 'settings.local.json' : 'settings.json';
  return path.join(scope.path, '.claude', file);
}
