import { DatabaseService } from './DatabaseService';

/** Pairs already recorded this run, so a hook per turn costs no write. */
const noted = new Set<string>();

/**
 * Record the session a hook payload names (`session_id`, on every hook) as
 * one of the task's (schema.taskSessions): a /clear or a fresh restart starts
 * a new one, and only the hooks see it. Never throws into the hook path.
 */
export function noteHookSession(taskId: string, payload: Record<string, unknown>): void {
  const sessionId = payload.session_id;
  if (typeof sessionId !== 'string' || !sessionId) return;
  const key = `${taskId}\0${sessionId}`;
  if (noted.has(key)) return;
  try {
    DatabaseService.noteTaskSession(taskId, sessionId);
    noted.add(key);
  } catch (err) {
    console.warn('[taskSessions] recording the session failed:', err);
  }
}
