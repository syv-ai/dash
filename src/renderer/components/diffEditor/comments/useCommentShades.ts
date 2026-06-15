import { useMemo } from 'react';
import type { LiveComment, Shade } from './types';
import { assignShades } from './shadeAssignment';

/** assignShades over the already-projected liveComments, memoized so the band
 *  decorations and the overlay share one map (instead of each recomputing). */
export function useCommentShades(liveComments: ReadonlyArray<LiveComment>): Map<string, Shade> {
  return useMemo(() => assignShades(liveComments), [liveComments]);
}
