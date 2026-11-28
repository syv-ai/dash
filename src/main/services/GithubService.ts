import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GithubIssue, PullRequest, PullRequestInfo } from '@shared/types';
import {
  githubBranchPrsFrom,
  mapGithubPrList,
  buildPrHeadRefspec,
  githubPrListArgs,
} from './githubPr';
import {
  actionsJobId,
  annotationsFrom,
  failedChecksFrom,
  failedLogExcerpt,
  failedStepsFrom,
  type FailedCheck,
} from './ciReport';

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 15_000;

export class GithubService {
  static async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('gh', ['auth', 'status'], {
        timeout: TIMEOUT_MS,
        env: process.env as Record<string, string>,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The GitHub profile of a commit's author, as GitHub matched it from the
   * commit's email (`author.html_url`), or null when it matched none.
   */
  static async commitAuthorUrl(cwd: string, sha: string): Promise<string | null> {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `repos/{owner}/{repo}/commits/${sha}`, '--jq', '.author.html_url // ""'],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );
    const url = stdout.trim();
    return url.startsWith('https://') ? url : null;
  }

  static async searchIssues(cwd: string, query: string): Promise<GithubIssue[]> {
    const args = ['issue', 'list'];
    if (query.trim()) {
      args.push('--search', query);
    }
    args.push('--json', 'number,title,labels,state,body,url,assignees', '--limit', '20');

    const { stdout } = await execFileAsync('gh', args, {
      cwd,
      timeout: TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });

    const raw = JSON.parse(stdout);
    return raw.map(mapIssue);
  }

  static async getIssue(cwd: string, number: number): Promise<GithubIssue> {
    const { stdout } = await execFileAsync(
      'gh',
      ['issue', 'view', String(number), '--json', 'number,title,labels,state,body,url,assignees'],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );

    return mapIssue(JSON.parse(stdout));
  }

  /** Every PR from `branch`, in any state, with CI status on open ones. */
  static async getPullRequestsFrom(cwd: string, branch: string): Promise<PullRequestInfo[]> {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr',
        'list',
        '--head',
        branch,
        '--state',
        'all',
        '--json',
        'number,title,url,state,headRefOid,statusCheckRollup',
        '--limit',
        '10',
      ],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );
    return githubBranchPrsFrom(JSON.parse(stdout));
  }

  /**
   * A PR's failed checks, each with what gh can tell about it: for GitHub
   * Actions jobs the failed steps, annotations and the log up to the failure.
   * A detail that can't be fetched becomes a notice rather than an error.
   */
  static async getFailedChecks(cwd: string, prNumber: number): Promise<FailedCheck[]> {
    const opts = { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> };
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'checks', String(prNumber), '--json', 'name,state,bucket,link,workflow,description'],
      opts,
    );
    const checks = failedChecksFrom(JSON.parse(stdout));
    return Promise.all(
      checks.map(async (check): Promise<FailedCheck> => {
        const jobId = actionsJobId(check.link);
        if (!jobId) return { ...check, notice: 'Not a GitHub Actions job; see the link.' };
        const [job, annotations, log] = await Promise.allSettled([
          execFileAsync('gh', ['api', `repos/{owner}/{repo}/actions/jobs/${jobId}`], opts),
          execFileAsync(
            'gh',
            ['api', `repos/{owner}/{repo}/check-runs/${jobId}/annotations`],
            opts,
          ),
          execFileAsync('gh', ['run', 'view', '--job', jobId, '--log'], {
            ...opts,
            maxBuffer: 64 * 1024 * 1024,
          }),
        ]);
        const json = (r: PromiseSettledResult<{ stdout: string }>): unknown => {
          try {
            return r.status === 'fulfilled' ? JSON.parse(r.value.stdout) : null;
          } catch {
            return null;
          }
        };
        return {
          ...check,
          failedSteps: failedStepsFrom(json(job)),
          annotations: annotationsFrom(json(annotations)),
          log: log.status === 'fulfilled' ? failedLogExcerpt(log.value.stdout) : undefined,
          notice:
            log.status === 'rejected'
              ? 'The job log could not be fetched (it may have expired); open the link.'
              : undefined,
        };
      }),
    );
  }

  /** Open PRs for the repo at `cwd`, newest first (gh's default order). */
  static async listPullRequests(cwd: string): Promise<PullRequest[]> {
    const { stdout } = await execFileAsync('gh', githubPrListArgs(), {
      cwd,
      timeout: TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });
    return mapGithubPrList(JSON.parse(stdout));
  }

  /**
   * Fetch a PR's head into a local branch so a worktree can be created on it.
   * Uses refs/pull/<n>/head, which covers fork PRs. Returns the local branch
   * name (= the PR head branch name). If the local branch already exists (the
   * PR was prepared before), the fetch fails with a non-fast-forward / exists
   * error — we treat that as "already present" and reuse it.
   */
  static async fetchPullRequestHead(
    cwd: string,
    prNumber: number,
    headRefName: string,
  ): Promise<string> {
    // No leading '+': git fast-forwards an existing local branch to the PR head
    // when it can, and creates the branch when it's absent — so a stale local
    // copy is refreshed for free, without ever rewinding local work.
    const refspec = buildPrHeadRefspec(prNumber, headRefName);
    try {
      await execFileAsync('git', ['fetch', 'origin', refspec], { cwd, timeout: TIMEOUT_MS });
    } catch (err) {
      // Reuse the existing local branch only for the *expected* fast-forward
      // conflicts: it has diverged from the PR head (non-ff), or it's checked out
      // in a worktree. Forcing either would clobber work, so keep what's there.
      // Any other failure (network, auth, a deleted PR ref) must not be masked as
      // "reuse stale" — surface it.
      const stderr =
        err && typeof err === 'object' && 'stderr' in err
          ? String((err as { stderr?: unknown }).stderr)
          : err instanceof Error
            ? err.message
            : String(err);
      const ffConflict =
        /non-fast-forward|\[rejected\]|refusing to fetch into branch|checked out/i.test(stderr);
      const exists = await GithubService.localBranchExists(cwd, headRefName);
      if (!ffConflict || !exists) throw err;
    }
    return headRefName;
  }

  private static async localBranchExists(cwd: string, branch: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
        cwd,
        timeout: TIMEOUT_MS,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** `created`: Dash made the branch for the task; false for an existing branch. */
  static async postBranchComment(
    cwd: string,
    issueNumber: number,
    branch: string,
    created = true,
  ): Promise<void> {
    const intro = created
      ? 'A task branch has been created for this issue:'
      : 'A task is working on this issue on an existing branch:';
    const body = `${intro}\n\n\`\`\`\n${branch}\n\`\`\``;
    await execFileAsync('gh', ['issue', 'comment', String(issueNumber), '--body', body], {
      cwd,
      timeout: TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });
  }

  /**
   * Link a branch to an issue's "Development" section via GitHub GraphQL API.
   * Uses createLinkedBranch which creates the branch on the remote and links it.
   * Must be called before the branch is pushed to the remote.
   * Returns the issue URL on success.
   */
  static async linkBranch(cwd: string, issueNumber: number, branch: string): Promise<string> {
    // Resolve owner/repo from the local git remote
    const { stdout: nwo } = await execFileAsync(
      'gh',
      ['repo', 'view', '--json', 'owner,name', '-q', '.owner.login + "/" + .name'],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );
    const [owner, repo] = nwo.trim().split('/');

    // Get repo + issue node IDs
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          id
          issue(number: $number) { id }
        }
      }
    `;
    const { stdout: idsRaw } = await execFileAsync(
      'gh',
      [
        'api',
        'graphql',
        '-F',
        `owner=${owner}`,
        '-F',
        `repo=${repo}`,
        '-F',
        `number=${issueNumber}`,
        '-f',
        `query=${query}`,
      ],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );

    const ids = JSON.parse(idsRaw);
    const repoId = ids.data?.repository?.id;
    const issueId = ids.data?.repository?.issue?.id;
    if (!repoId || !issueId) {
      throw new Error('Could not resolve repository or issue ID');
    }

    // Resolve the branch OID from the local repo
    const { stdout: oid } = await execFileAsync('git', ['rev-parse', branch], {
      cwd,
      timeout: TIMEOUT_MS,
    });

    // createLinkedBranch creates the branch on the remote and links it to the issue
    const mutation = `
      mutation($repoId: ID!, $issueId: ID!, $oid: GitObjectID!, $branch: String!) {
        createLinkedBranch(input: {
          repositoryId: $repoId,
          issueId: $issueId,
          oid: $oid,
          name: $branch
        }) {
          linkedBranch { id }
        }
      }
    `;
    await execFileAsync(
      'gh',
      [
        'api',
        'graphql',
        '-F',
        `repoId=${repoId}`,
        '-F',
        `issueId=${issueId}`,
        '-F',
        `oid=${oid.trim()}`,
        '-F',
        `branch=${branch}`,
        '-f',
        `query=${mutation}`,
      ],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );

    return `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
  }
}

function mapIssue(raw: Record<string, unknown>): GithubIssue {
  const labels = Array.isArray(raw.labels)
    ? raw.labels.map((l: Record<string, unknown>) => (typeof l === 'string' ? l : l.name) as string)
    : [];
  const assignees = Array.isArray(raw.assignees)
    ? raw.assignees.map(
        (a: Record<string, unknown>) => (typeof a === 'string' ? a : a.login) as string,
      )
    : [];

  return {
    number: raw.number as number,
    title: raw.title as string,
    labels,
    state: raw.state as string,
    body: raw.body as string,
    url: raw.url as string,
    assignees,
  };
}
