import { REMOTE_HEAD_REF, type BranchInfo } from '../../../shared/types';

/**
 * Branches the picker offers. origin/HEAD is a valid base for a new branch but
 * not a branch to check out, so it only appears when creating a new one.
 */
export function pickableBranches(branches: BranchInfo[], createNewBranch: boolean): BranchInfo[] {
  return createNewBranch ? branches : branches.filter((b) => b.ref !== REMOTE_HEAD_REF);
}
