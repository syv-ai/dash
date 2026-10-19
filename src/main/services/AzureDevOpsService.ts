import type {
  AzureDevOpsConfig,
  AzureDevOpsWorkItem,
  AzureDevOpsWorkItemRef,
  PullRequest,
  CiState,
  PullRequestInfo,
} from '@shared/types';
import { normalizeAdoProject } from '@shared/urls';
import { mapAdoPrList } from './adoPr';
import { describeAdoFailure } from './adoErrors';
import { GitService } from './GitService';
import { ciFromAdo, relevantPrs } from './prRelevance';

const TIMEOUT_MS = 15_000;
const API_VERSION = '7.1';

/** A failed Azure DevOps call, with the HTTP status when there was a response. */
export class AdoRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AdoRequestError';
  }
}

function authHeader(pat: string): string {
  return 'Basic ' + Buffer.from(':' + pat).toString('base64');
}

/**
 * URL-encode the project name for use as a path segment. ADO project names can
 * contain spaces and other characters that are invalid in a raw URL path; left
 * unencoded they produce a malformed URL → 404, which the pickers surface as a
 * misleading "No results found". Repository names are already encoded at their
 * call sites; this does the same for the project segment. Normalizing first keeps
 * a config saved in encoded form (`AI%20og%20DT`) from being encoded twice.
 */
export function adoProjectSegment(config: AzureDevOpsConfig): string {
  return encodeURIComponent(normalizeAdoProject(config.project));
}

/**
 * One Azure DevOps REST call. A plain function (no `this`), so it can be passed
 * around as an injectable default. Bad auth answers 401 rather than a sign-in
 * page (`X-TFS-FedAuthRedirect: Suppress`); failures throw AdoRequestError.
 */
export async function adoRequest(
  config: AzureDevOpsConfig,
  path: string,
  options?: { method?: string; body?: unknown; contentType?: string; apiVersion?: string },
): Promise<unknown> {
  const baseUrl = config.organizationUrl.replace(/\/+$/, '');
  const separator = path.includes('?') ? '&' : '?';
  const url = `${baseUrl}/${path}${separator}api-version=${options?.apiVersion ?? API_VERSION}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const context = {
    organizationUrl: baseUrl,
    project: normalizeAdoProject(config.project),
    pat: config.pat,
  };

  try {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: options?.method ?? 'GET',
        headers: {
          Authorization: authHeader(config.pat),
          'Content-Type': options?.contentType ?? 'application/json',
          'X-TFS-FedAuthRedirect': 'Suppress',
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      throw new AdoRequestError(describeAdoFailure({ error }, context));
    }

    // 203 and HTML answers are ADO's sign-in page, not data; resp.ok alone lets them through.
    const contentType = resp.headers.get('content-type');
    if (!resp.ok || resp.status === 203 || /text\/html/i.test(contentType ?? '')) {
      const body = await resp.text().catch(() => '');
      throw new AdoRequestError(
        describeAdoFailure({ status: resp.status, body, contentType }, context),
        resp.status,
      );
    }

    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

export class AzureDevOpsService {
  private static proj(config: AzureDevOpsConfig): string {
    return adoProjectSegment(config);
  }

  private static request(
    config: AzureDevOpsConfig,
    path: string,
    options?: { method?: string; body?: unknown; contentType?: string; apiVersion?: string },
  ): Promise<unknown> {
    return adoRequest(config, path, options);
  }

  /** The id of the identity the PAT belongs to (what a reviewer vote is cast as). */
  static async getMyId(config: AzureDevOpsConfig): Promise<string> {
    // connectionData only answers on the preview version; plain 7.1 is a 400.
    const data = (await adoRequest(config, '_apis/connectionData', {
      apiVersion: '7.1-preview',
    })) as { authenticatedUser?: { id?: unknown } };
    const id = data.authenticatedUser?.id;
    if (typeof id !== 'string' || !id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id)) {
      throw new AdoRequestError('Azure DevOps did not say who the token belongs to', 401);
    }
    return id;
  }

  /** Resolves when the config works; rejects with a message saying what to fix. */
  static async testConnection(config: AzureDevOpsConfig): Promise<void> {
    await this.request(config, `${this.proj(config)}/_apis/wit/queries`, { method: 'GET' });
  }

  static async searchWorkItems(
    config: AzureDevOpsConfig,
    query: string,
  ): Promise<AzureDevOpsWorkItem[]> {
    const trimmed = query.trim();

    // A purely numeric query (optionally "#123") is almost always a work-item ID
    // — the most natural way ADO users reference an item. Title CONTAINS wouldn't
    // match it. Try a direct ID lookup first and fall through to the title search
    // only if that turns up nothing (so "123" can still match a titled item).
    const idMatch = trimmed.match(/^#?(\d+)$/);
    if (idMatch) {
      const id = parseInt(idMatch[1]!, 10);
      try {
        const byId = await this.getWorkItemsByIds(config, [id], { expand: true });
        if (byId.length > 0) return byId;
      } catch {
        // Nonexistent id → 404; fall through to the title search below.
      }
    }

    const sanitized = trimmed.replace(/[^a-zA-Z0-9\s\-_]/g, '');
    // Endpoint is project-scoped, so no need to filter by TeamProject
    const wiql = sanitized
      ? `SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '${sanitized}' ORDER BY [System.ChangedDate] DESC`
      : `SELECT [System.Id] FROM WorkItems WHERE [System.State] <> 'Closed' AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC`;

    const wiqlResult = (await this.request(config, `${this.proj(config)}/_apis/wit/wiql`, {
      method: 'POST',
      body: { query: wiql },
    })) as { workItems?: { id: number }[] };
    const ids = wiqlResult.workItems?.map((w) => w.id).slice(0, 20) ?? [];
    if (ids.length === 0) return [];

    return this.getWorkItemsByIds(config, ids, { expand: true });
  }

  static async getWorkItem(config: AzureDevOpsConfig, id: number): Promise<AzureDevOpsWorkItem> {
    const items = await this.getWorkItemsByIds(config, [id], { expand: true });
    if (items.length === 0) throw new Error(`Work item ${id} not found`);
    return items[0]!;
  }

  /**
   * The PRs from the branch checked out at `cwd`, newest first, with the
   * current ones flagged (see relevantPrs) and CI status on open ones. Reads
   * the live branch; none on the default branch or a detached HEAD.
   */
  static async getPullRequestsForCheckout(
    config: AzureDevOpsConfig,
    repositoryName: string,
    cwd: string,
    defaultBranch: string,
  ): Promise<PullRequestInfo[]> {
    const branch = await GitService.getBranch(cwd);
    if (!branch || branch === defaultBranch) return [];
    const sourceRef = `refs/heads/${branch}`;
    const result = (await this.request(
      config,
      `${this.proj(config)}/_apis/git/repositories/${encodeURIComponent(repositoryName)}/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(sourceRef)}&searchCriteria.status=all&$top=10`,
    )) as {
      value?: Array<{
        pullRequestId: number;
        title: string;
        status: string;
        lastMergeSourceCommit?: { commitId?: string };
        repository?: { project?: { id?: string } };
      }>;
    };

    const baseUrl = config.organizationUrl.replace(/\/+$/, '');
    const stateMap: Record<string, 'open' | 'merged' | 'closed'> = {
      active: 'open',
      completed: 'merged',
      abandoned: 'closed',
    };
    const prs = await Promise.all(
      (result.value ?? []).map(async (pr): Promise<PullRequestInfo> => {
        const state = stateMap[pr.status] ?? 'open';
        return {
          number: pr.pullRequestId,
          title: pr.title,
          url: `${baseUrl}/${this.proj(config)}/_git/${repositoryName}/pullrequest/${pr.pullRequestId}`,
          state,
          provider: 'ado',
          headSha: pr.lastMergeSourceCommit?.commitId,
          ci:
            state === 'open'
              ? await this.getPullRequestCi(
                  config,
                  repositoryName,
                  pr.pullRequestId,
                  pr.repository?.project?.id,
                )
              : null,
        };
      }),
    );
    return relevantPrs(prs, (sha) => GitService.hasMovedPast(cwd, sha));
  }

  /**
   * A PR's checks (see ciFromAdo) from its policy evaluations, which need the
   * project's id, and its statuses. Null when neither can be read.
   */
  private static async getPullRequestCi(
    config: AzureDevOpsConfig,
    repositoryName: string,
    prId: number,
    projectId: string | undefined,
  ): Promise<CiState | null> {
    const values = (r: PromiseSettledResult<unknown>): unknown =>
      r.status === 'fulfilled' ? (r.value as { value?: unknown } | null)?.value : null;
    const [evaluations, statuses] = await Promise.allSettled([
      projectId
        ? this.request(
            config,
            `${this.proj(config)}/_apis/policy/evaluations?artifactId=${encodeURIComponent(
              `vstfs:///CodeReview/CodeReviewId/${projectId}/${prId}`,
            )}`,
            // Policy evaluations exist only as a preview API.
            { apiVersion: `${API_VERSION}-preview.1` },
          )
        : Promise.resolve(null),
      this.request(
        config,
        `${this.proj(config)}/_apis/git/repositories/${encodeURIComponent(repositoryName)}/pullRequests/${prId}/statuses`,
      ),
    ]);
    return ciFromAdo(values(evaluations), values(statuses));
  }

  /** Active (open) PRs for `repositoryName`, most-recent first. */
  static async listPullRequests(
    config: AzureDevOpsConfig,
    repositoryName: string,
  ): Promise<PullRequest[]> {
    const result = (await this.request(
      config,
      `${this.proj(config)}/_apis/git/repositories/${encodeURIComponent(
        repositoryName,
      )}/pullrequests?searchCriteria.status=active&$top=50`,
    )) as { value?: unknown };

    return mapAdoPrList(result.value, {
      organizationUrl: config.organizationUrl,
      project: config.project,
      repository: repositoryName,
    });
  }

  static async postBranchComment(
    config: AzureDevOpsConfig,
    workItemId: number,
    branch: string,
  ): Promise<void> {
    const comment = `A task branch has been created for this work item:\n\n<code>${branch}</code>`;

    await this.request(config, `${this.proj(config)}/_apis/wit/workitems/${workItemId}`, {
      method: 'PATCH',
      contentType: 'application/json-patch+json',
      body: [
        {
          op: 'add',
          path: '/fields/System.History',
          value: comment,
        },
      ],
    });
  }

  private static async getWorkItemsByIds(
    config: AzureDevOpsConfig,
    ids: number[],
    options?: { expand?: boolean },
  ): Promise<AzureDevOpsWorkItem[]> {
    const idsParam = ids.join(',');
    // ADO API does not allow $expand and fields together; when expanding relations, omit fields
    const fields = options?.expand
      ? ''
      : '&fields=System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo,System.Tags,System.Description,Microsoft.VSTS.Common.AcceptanceCriteria';
    const expand = options?.expand ? '&$expand=relations' : '';
    const result = (await this.request(
      config,
      `${this.proj(config)}/_apis/wit/workitems?ids=${idsParam}${fields}${expand}`,
    )) as {
      value: Array<RawWorkItem>;
    };

    const items = result.value.map((item) => this.mapWorkItem(item, config));

    // Resolve parent chains if relations were expanded
    if (options?.expand) {
      await this.resolveParents(config, result.value, items);
    }

    return items;
  }

  /** Walk parent links up to 3 levels (e.g. Task → Story → Feature → Epic) */
  private static async resolveParents(
    config: AzureDevOpsConfig,
    rawItems: RawWorkItem[],
    mapped: AzureDevOpsWorkItem[],
  ): Promise<void> {
    const PARENT_REL = 'System.LinkTypes.Hierarchy-Reverse';

    // Collect all parent IDs needed
    const parentIdMap = new Map<number, number[]>(); // itemId → chain of parent IDs
    for (const raw of rawItems) {
      const parentRel = raw.relations?.find((r) => r.rel === PARENT_REL);
      if (parentRel) {
        const parentId = this.extractIdFromUrl(parentRel.url);
        if (parentId) parentIdMap.set(raw.id, [parentId]);
      }
    }

    if (parentIdMap.size === 0) return;

    // Fetch up to 3 levels of parents
    const allParentIds = new Set<number>();
    const fetched = new Map<number, AzureDevOpsWorkItemRef>();

    for (let level = 0; level < 3; level++) {
      const idsToFetch = new Set<number>();
      for (const chain of parentIdMap.values()) {
        const lastId = chain[chain.length - 1]!;
        if (!fetched.has(lastId)) idsToFetch.add(lastId);
      }
      // Remove already-fetched
      for (const id of allParentIds) idsToFetch.delete(id);
      if (idsToFetch.size === 0) break;

      try {
        // Fetch with relations expanded (cannot combine $expand with fields)
        const result = (await this.request(
          config,
          `${this.proj(config)}/_apis/wit/workitems?ids=${[...idsToFetch].join(',')}&$expand=relations`,
        )) as { value: Array<RawWorkItem> };

        for (const raw of result.value) {
          const item = this.mapWorkItem(raw, config);
          fetched.set(item.id, {
            id: item.id,
            title: item.title,
            type: item.type,
            state: item.state,
            url: item.url,
          });
          allParentIds.add(item.id);

          // Extend chains with next-level parent
          const nextParent = raw.relations?.find((r) => r.rel === PARENT_REL);
          if (nextParent) {
            const nextId = this.extractIdFromUrl(nextParent.url);
            if (nextId) {
              for (const chain of parentIdMap.values()) {
                if (chain[chain.length - 1] === raw.id) {
                  chain.push(nextId);
                }
              }
            }
          }
        }
      } catch {
        break; // Best effort — stop if any level fails
      }
    }

    // Attach parent chains to mapped items
    for (const item of mapped) {
      const chain = parentIdMap.get(item.id);
      if (chain) {
        item.parents = chain
          .map((id) => fetched.get(id))
          .filter(Boolean) as AzureDevOpsWorkItemRef[];
      }
    }
  }

  private static extractIdFromUrl(url: string): number | null {
    const match = url.match(/\/workItems\/(\d+)$/i);
    return match ? parseInt(match[1]!, 10) : null;
  }

  private static mapWorkItem(raw: RawWorkItem, config: AzureDevOpsConfig): AzureDevOpsWorkItem {
    const fields = raw.fields;
    const assignedTo = fields['System.AssignedTo'] as
      | { displayName?: string; uniqueName?: string }
      | undefined;
    const tags = fields['System.Tags'] as string | undefined;
    const baseUrl = config.organizationUrl.replace(/\/+$/, '');

    return {
      id: raw.id,
      title: (fields['System.Title'] as string) ?? '',
      state: (fields['System.State'] as string) ?? '',
      type: (fields['System.WorkItemType'] as string) ?? '',
      url: raw._links?.html?.href || `${baseUrl}/${this.proj(config)}/_workitems/edit/${raw.id}`,
      assignedTo: assignedTo?.displayName ?? assignedTo?.uniqueName,
      tags: tags
        ? tags
            .split(';')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
      description: fields['System.Description'] as string | undefined,
      acceptanceCriteria: fields['Microsoft.VSTS.Common.AcceptanceCriteria'] as string | undefined,
    };
  }
}

interface RawWorkItem {
  id: number;
  fields: Record<string, unknown>;
  _links: { html: { href: string } };
  relations?: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>;
}
