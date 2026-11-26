/*
 * The collapsed task sidebar is a rail (see CLAUDE.md's sidebar states): the
 * account's limits, how far the branch and its upstream have moved apart, and
 * the changed files, stacked. These decide what it shows and where a click
 * on it leads.
 */

import type { GitStatus } from '../../../shared/types';
import type { CodeSegment } from './sidebarState';

type Status = Pick<GitStatus, 'hasUpstream' | 'ahead' | 'behind' | 'files'>;

/** The rail's parts, each null (or false) where it has nothing to say. */
export interface RailParts {
  /** The 5-hour and weekly limits (the account reports them, the user shows them). */
  limits: boolean;
  /** The branch against its upstream, once they have moved apart. */
  sync: { ahead: number; behind: number } | null;
  /** The changed files, as Files' tab counts them, once there are any. */
  changes: number | null;
}

/** What the rail shows, from what the full sidebar shows: `limitsShown`, the
 *  limits row has them; `status`, the task's git status (null till loaded). */
export function railParts({
  limitsShown,
  status,
}: {
  limitsShown: boolean;
  status: Status | null;
}): RailParts {
  const outOfSync = !!status?.hasUpstream && (status.ahead > 0 || status.behind > 0);
  return {
    limits: limitsShown,
    sync: outOfSync ? { ahead: status.ahead, behind: status.behind } : null,
    changes: status && status.files.length > 0 ? status.files.length : null,
  };
}

/** What can be clicked on the rail: a part, or the space around them. */
export type RailTarget = 'changes' | 'sync' | 'space';

/**
 * The view a click on the rail shows the sidebar on, narrow: the changes on
 * Files, ahead/behind on History; its own space as it was (null). A limit
 * isn't a target: it only has its tooltip.
 */
export const RAIL_VIEW: Record<RailTarget, CodeSegment | null> = {
  changes: 'files',
  sync: 'history',
  space: null,
};
