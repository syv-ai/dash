import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GithubIssue, PullRequestInfo } from '@shared/types';

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

  static async getPullRequestForBranch(
    cwd: string,
    branch: string,
  ): Promise<PullRequestInfo | null> {
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
        'number,title,url,state',
        '--limit',
        '5',
      ],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );

    const prs = JSON.parse(stdout);
    if (!Array.isArray(prs) || prs.length === 0) return null;

    // Prefer open PR, then merged, then closed
    const sorted = prs.sort((a: { state: string }, b: { state: string }) => {
      const order: Record<string, number> = { OPEN: 0, MERGED: 1, CLOSED: 2 };
      return (order[a.state] ?? 3) - (order[b.state] ?? 3);
    });

    return {
      number: sorted[0].number,
      title: sorted[0].title,
      url: sorted[0].url,
      state:
        sorted[0].state === 'MERGED' ? 'merged' : sorted[0].state === 'OPEN' ? 'open' : 'closed',
      provider: 'github',
    };
  }

  static async postBranchComment(cwd: string, issueNumber: number, branch: string): Promise<void> {
    const body = `A task branch has been created for this issue:\n\n\`\`\`\n${branch}\n\`\`\``;
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
