import { ensureCommits, fetchHeadInto, gitStderr, runGit, type RunGit } from './localCommits';

/**
 * Where a fork PR's head lives, from the PR (`GET …/pullRequests/{id}`): the
 * fork's clone URL, its source ref there, and the head commit ADO last merged.
 */
export interface AdoForkHead {
  /** The fork's clone URL, in origin's scheme (ssh or https) where ADO gives it; null when it gives neither. */
  url: string | null;
  /** The source branch's full ref in the fork (`refs/heads/…`). */
  ref: string;
  /** `lastMergeSourceCommit`: the head when ADO last merged the PR; null before its first merge. */
  sha: string | null;
}

interface RawForkPr {
  sourceRefName?: string;
  forkSource?: {
    name?: string;
    repository?: { remoteUrl?: string; sshUrl?: string } | null;
  } | null;
  lastMergeSourceCommit?: { commitId?: string } | null;
}

const SSH_REMOTE = /^(ssh:\/\/|[\w.-]+@[\w.-]+:)/;
/** A clone URL git may be handed: https or ssh only, so no `ext::` transport or `-option` gets in. */
const SAFE_URL = /^(https:\/\/|ssh:\/\/|[\w.-]+@[\w.-]+:)[^\s]+$/;

/**
 * The fork a PR's head is in; null for a PR from a branch of the repo itself
 * (no `forkSource`). The URL follows origin's scheme, so git reaches the fork
 * with the credentials it already uses for origin (same host): no PAT is handed to git.
 */
export function adoForkHead(raw: unknown, originUrl: string | null): AdoForkHead | null {
  const pr = (raw ?? {}) as RawForkPr;
  if (!pr.forkSource) return null;
  const ref = pr.sourceRefName || pr.forkSource.name || '';
  if (!ref.startsWith('refs/heads/')) return null;
  const { remoteUrl, sshUrl } = pr.forkSource.repository ?? {};
  const ordered =
    originUrl && SSH_REMOTE.test(originUrl) ? [sshUrl, remoteUrl] : [remoteUrl, sshUrl];
  return {
    url: ordered.find((u): u is string => !!u && SAFE_URL.test(u)) ?? null,
    ref,
    sha: pr.lastMergeSourceCommit?.commitId || null,
  };
}

/**
 * Put fork PR `number`'s head on local branch `branch` (`prTaskBranch`), with
 * no upstream: the fork's branch is the PR's, and pushing there may not be
 * allowed, so a push from the task fails rather than landing on origin.
 *
 * First from the fork itself, by its URL (no remote is added). When that
 * fails (no URL, no read access to the fork, another organization), from
 * origin: the head commit by its sha, else through the PR's merge ref, whose
 * second parent it is (Azure Repos keeps `refs/pull/<id>/merge` in the
 * target, not a head ref); then from the checkout itself onto the branch.
 */
export async function fetchAdoForkHead(
  cwd: string,
  number: number,
  head: AdoForkHead,
  branch: string,
  run: RunGit = runGit,
): Promise<void> {
  const target = `refs/heads/${branch}`;
  let forkError: unknown = null;
  if (head.url) {
    try {
      await fetchHeadInto(cwd, head.url, `${head.ref}:${target}`, branch, run);
      return;
    } catch (err) {
      forkError = err;
    }
  }
  if (!head.sha) {
    throw new Error(
      `Could not fetch PR ${number}'s source branch from its fork${firstLine(forkError)}, and Azure DevOps names no head commit to fetch from origin`,
    );
  }
  try {
    await ensureCommits(cwd, [head.sha], run, [`refs/pull/${number}/merge`]);
  } catch {
    throw new Error(
      `Could not fetch PR ${number}'s head ${head.sha.slice(0, 8)} from its fork${firstLine(forkError)} or from origin`,
    );
  }
  await fetchHeadInto(cwd, '.', `${head.sha}:${target}`, branch, run);
}

const firstLine = (err: unknown) => {
  const line = err
    ? gitStderr(err)
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean)
    : undefined;
  return line ? ` (${line})` : '';
};

/**
 * A fork PR's head branch on the fork's own web page (Azure Repos browses a
 * branch as `?version=GB<branch>`); null for a same-repo PR or a fork without
 * an https URL. Any user info in the clone URL is dropped.
 */
export function adoForkBranchUrl(pr: RawForkPr): string | null {
  if (!pr.forkSource) return null;
  const remote = pr.forkSource.repository?.remoteUrl ?? '';
  const branch = (pr.sourceRefName || pr.forkSource.name || '').replace(/^refs\/heads\//, '');
  let url: URL;
  try {
    url = new URL(remote);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !branch) return null;
  url.username = '';
  url.password = '';
  url.search = `version=GB${encodeURIComponent(branch)}`;
  return url.toString();
}
