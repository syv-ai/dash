/*
 * The collapsed task sidebar is a rail (see CLAUDE.md's sidebar states): the
 * usage row's levels (`levelCells`), how far the branch and its upstream have
 * moved apart, the changed files and the PRs, stacked; Details and the
 * terminal at its foot. These decide what it shows and where a click on it
 * leads.
 */

import type { GitStatus } from '../../../shared/types';
import type { SidebarView } from './sidebarState';

type Status = Pick<GitStatus, 'hasUpstream' | 'ahead' | 'behind' | 'files'>;

/** The rail's parts, each null (or false) where it has nothing to say. */
export interface RailParts {
  /** The branch against its upstream, once they have moved apart. */
  sync: { ahead: number; behind: number } | null;
  /** The changed files, as Files' tab counts them, once there are any. */
  changes: number | null;
}

/** What the rail shows of the task's git status (null till loaded). */
export function railParts(status: Status | null): RailParts {
  const outOfSync = !!status?.hasUpstream && (status.ahead > 0 || status.behind > 0);
  return {
    sync: outOfSync ? { ahead: status.ahead, behind: status.behind } : null,
    changes: status && status.files.length > 0 ? status.files.length : null,
  };
}

/** What leads off the rail: a part, a PR picked from its list, an action at
 *  its foot, or the space around them. */
export type RailTarget = 'changes' | 'sync' | 'pr' | 'details' | 'terminal' | 'space';

/** How the sidebar shows, narrow, from the rail. */
export interface RailShow {
  /** The view it shows on; null: the view it has. */
  view: SidebarView | null;
  /** The terminal drawer opens, its active terminal taking the keyboard. */
  terminal: boolean;
}

const show = (view: SidebarView | null, terminal = false): RailShow => ({ view, terminal });

/**
 * Where each rail target shows the sidebar, narrow (R3): the changes on
 * Files, ahead/behind on History, Details on Details; a PR picked from the
 * rail's list as review mode has it (entering it shows Overview, R10); the
 * terminal and the space on the view it has, the terminal drawer opened
 * (R11). A limit isn't a target: it only has its tooltip.
 */
export const RAIL_SHOW: Record<RailTarget, RailShow> = {
  changes: show('files'),
  sync: show('history'),
  pr: show(null),
  details: show('details'),
  terminal: show(null, true),
  space: show(null),
};
