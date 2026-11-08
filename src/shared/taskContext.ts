import type {
  AzureDevOpsWorkItem,
  GithubIssue,
  LinkedItem,
  LinkedGithubIssue,
  LinkedAdoWorkItem,
} from './types';

/** A fetched GitHub issue as a task stores it (the task dialog and dashctl). */
export function linkedGithubIssue(issue: GithubIssue): LinkedGithubIssue {
  return {
    provider: 'github',
    id: issue.number,
    title: issue.title,
    url: issue.url,
    labels: issue.labels.length > 0 ? issue.labels : undefined,
    body: issue.body || undefined,
  };
}

/** A fetched Azure DevOps work item as a task stores it. */
export function linkedAdoWorkItem(wi: AzureDevOpsWorkItem): LinkedAdoWorkItem {
  return {
    provider: 'ado',
    id: wi.id,
    title: wi.title,
    url: wi.url,
    type: wi.type,
    state: wi.state,
    tags: wi.tags,
    description: wi.description,
    acceptanceCriteria: wi.acceptanceCriteria,
    parents: wi.parents,
  };
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function formatGithubIssue(issue: LinkedGithubIssue): string {
  const labels =
    issue.labels && issue.labels.length > 0 ? `Labels: ${issue.labels.join(', ')}\n` : '';
  const body = truncate(issue.body, 2000);
  return `## Issue #${issue.id}: ${issue.title}\n${labels}${body}`;
}

function formatAdoWorkItem(wi: LinkedAdoWorkItem): string {
  const meta = [
    `Type: ${wi.type}`,
    `State: ${wi.state}`,
    wi.tags?.length ? `Tags: ${wi.tags.join(', ')}` : '',
    wi.parents?.length
      ? `Hierarchy: ${wi.parents.map((p) => `${p.type} #${p.id} "${p.title}"`).join(' → ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const desc = truncate(wi.description, 2000);
  const ac = truncate(wi.acceptanceCriteria, 1000);
  return [
    `## Work Item #${wi.id}: ${wi.title}`,
    meta,
    `URL: ${wi.url}`,
    desc ? `### Description\n${desc}` : '',
    ac ? `### Acceptance Criteria\n${ac}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Build a task context prompt from linked items.
 * Returns null if there are no items to format.
 */
export function formatTaskContextPrompt(linkedItems: LinkedItem[]): string | null {
  const ghItems = linkedItems.filter((i): i is LinkedGithubIssue => i.provider === 'github');
  const adoItems = linkedItems.filter((i): i is LinkedAdoWorkItem => i.provider === 'ado');

  const blocks: string[] = [];

  if (ghItems.length > 0) {
    blocks.push(
      `I'm working on the following GitHub issue(s):\n\n${ghItems.map(formatGithubIssue).join('\n\n')}`,
    );
  }

  if (adoItems.length > 0) {
    blocks.push(
      `I'm working on the following Azure DevOps work item(s):\n\n${adoItems.map(formatAdoWorkItem).join('\n\n---\n\n')}`,
    );
  }

  if (blocks.length === 0) return null;

  return `${blocks.join('\n\n')}\n\nPlease help me implement a solution for this.`;
}

/**
 * The context a task persists (re-injected on /clear and /compact): its own
 * context prompt, then its linked items'.
 */
export function buildTaskContext(
  contextPrompt: string | null | undefined,
  linkedItems: LinkedItem[] | null | undefined,
): string {
  return [
    contextPrompt?.trim(),
    linkedItems && linkedItems.length > 0 ? formatTaskContextPrompt(linkedItems) : '',
  ]
    .filter((part): part is string => !!part)
    .join('\n\n');
}

/**
 * A task's persisted context after its linked items change from `before` to
 * `after`: the block `before` produced is replaced by the one `after` does.
 */
export function relinkTaskContext(
  stored: string | null,
  before: LinkedItem[],
  after: LinkedItem[],
): string {
  const oldBlock = before.length > 0 ? formatTaskContextPrompt(before) : null;
  let own = stored ?? '';
  if (oldBlock && own.endsWith(oldBlock)) own = own.slice(0, -oldBlock.length);
  return buildTaskContext(own, after);
}
