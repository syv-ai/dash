/**
 * Who is calling the control API, and the `X-Dash-Caller` header format for
 * it: `dashctl` sends the header, a task's from its `DASH_CALLER`. Pure (no
 * electron, no path aliases).
 */
export type Caller = { kind: 'orchestrator' } | { kind: 'task'; taskId: string };

export type CallerKind = Caller['kind'];

/** Task ids are UUIDs; accept any id-safe token so the header never carries paths or spaces. */
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function callerString(caller: Caller): string {
  return caller.kind === 'orchestrator' ? 'orchestrator' : `task:${caller.taskId}`;
}

/** Parse an `X-Dash-Caller` header (`orchestrator` or `task:<id>`); null when malformed. */
export function parseCaller(header: string | null | undefined): Caller | null {
  if (header === 'orchestrator') return { kind: 'orchestrator' };
  if (typeof header !== 'string' || !header.startsWith('task:')) return null;
  const taskId = header.slice('task:'.length);
  return TASK_ID_RE.test(taskId) ? { kind: 'task', taskId } : null;
}
