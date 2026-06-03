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
