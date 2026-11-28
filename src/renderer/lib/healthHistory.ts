/* The health popover's timeline in the renderer (`systemHealthStore`). */
import { HEALTH_HISTORY_MS, type HealthPoint } from '@shared/systemHealth';

/** `history` with `point` added at the end (unless it is not newer than the
 *  last), less anything older than the window before it. */
export function appendPoint(
  history: readonly HealthPoint[],
  point: HealthPoint,
  windowMs = HEALTH_HISTORY_MS,
): readonly HealthPoint[] {
  const last = history[history.length - 1];
  if (last && point.at <= last.at) return history;
  const from = history.findIndex((p) => point.at - p.at <= windowMs);
  return [...(from === -1 ? [] : history.slice(from)), point];
}
