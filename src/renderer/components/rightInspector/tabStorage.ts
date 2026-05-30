export type RightInspectorTab = 'changes' | 'structured';

const VALID: ReadonlySet<string> = new Set(['changes', 'structured']);

function key(taskId: string): string {
  return `rightInspectorTab:${taskId}`;
}

export function getStoredTab(taskId: string): RightInspectorTab {
  const v = localStorage.getItem(key(taskId));
  return v && VALID.has(v) ? (v as RightInspectorTab) : 'changes';
}

export function setStoredTab(taskId: string, tab: RightInspectorTab): void {
  localStorage.setItem(key(taskId), tab);
}
