import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GithubIssue, PullRequest, PullRequestInfo } from '@shared/types';
import { githubBranchPrsFrom, mapGithubPrList, githubPrListArgs } from './githubPr';
import {
  actionsJobId,
  annotationsFrom,
  failedChecksFrom,
  failedLogExcerpt,
  failedStepsFrom,
  type FailedCheck,
} from './ciReport';
import {
  fetchHeadInto,
  fetchOriginBranch,
  preparePrBranch,
  runGit,
  type RunGit,
} from './prReview/localCommits';

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

  /** Where PR `prNumber`'s head is, as gh tells it: its branch, and whether that's in a fork. */
  static async pullRequestHead(
    cwd: string,
    prNumber: number,
  ): Promise<{ headRefName: string; fromFork: boolean }> {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', String(prNumber), '--json', 'headRefName,isCrossRepository'],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );
    const pr = JSON.parse(stdout) as { headRefName?: string; isCrossRepository?: boolean };
    if (!pr.headRefName) throw new Error(`gh names no head branch for PR #${prNumber}`);
    return { headRefName: pr.headRefName, fromFork: pr.isCrossRepository === true };
  }

  /**
   * Put PR `pr`'s head on its task branch (see `prTaskBranch`) and answer its
   * name: a same-repo PR's from origin's branch, tracking it; a fork's from
   * origin's `refs/pull/<n>/head`, which GitHub keeps for every PR, with no upstream.
   */
  static fetchPullRequestBranch(
    cwd: string,
    pr: { number: number; headRefName: string; fromFork: boolean },
    run: RunGit = runGit,
  ): Promise<string> {
    return preparePrBranch(pr, {
      origin: (branch) => fetchOriginBranch(cwd, branch, run),
      fork: (branch) =>
        fetchHeadInto(
          cwd,
          'origin',
          `refs/pull/${pr.number}/head:refs/heads/${branch}`,
          branch,
          run,
        ),
    });
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
