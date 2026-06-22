import type { DiffComment } from '../../../../shared/types';

export type { DiffComment } from '../../../../shared/types';

/** A DiffComment with the Monaco decoration id that currently tracks its
 *  line range in the open model. Only ever exists for the currently-open
 *  file in EditorPane. */
export interface LiveComment extends DiffComment {
  decorationId: string;
}

export interface LineRange {
  start: number;
  end: number;
}

/** Snapshot pushed to the store when a binding tears down. Captures the
 *  latest range as tracked by Monaco's stickiness — covers line shifts
 *  from typing in the file before the user switched away. */
export interface RangeSnapshot {
  id: string;
  startLine: number;
  endLine: number;
}

/** Color slot assigned to a comment for band + bubble rendering. Only used
 *  when comments partially overlap (share some but not all lines); same-
 *  anchor stacks reuse one shade. */
export type Shade = 1 | 2;

/** Per-row band rendering signature. '1' or '2' = one shade only; '12' = a
 *  row owned by both shades (renders a split linear-gradient). */
export type RowSignature = '1' | '2' | '12';
