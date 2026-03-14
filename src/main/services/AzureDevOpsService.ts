import type { AzureDevOpsConfig, AzureDevOpsWorkItem, AzureDevOpsWorkItemRef } from '@shared/types';

const TIMEOUT_MS = 15_000;
const API_VERSION = '7.1';

export class AzureDevOpsService {
  private static authHeader(pat: string): string {
    return 'Basic ' + Buffer.from(':' + pat).toString('base64');
  }

  private static async request(
    config: AzureDevOpsConfig,
    path: string,
    options?: { method?: string; body?: unknown; contentType?: string },
  ): Promise<unknown> {
    const baseUrl = config.organizationUrl.replace(/\/+$/, '');
    const separator = path.includes('?') ? '&' : '?';
    const url = `${baseUrl}/${path}${separator}api-version=${API_VERSION}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        method: options?.method ?? 'GET',
        headers: {
          Authorization: this.authHeader(config.pat),
          'Content-Type': options?.contentType ?? 'application/json',
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`ADO API ${resp.status}: ${text.slice(0, 200)}`);
      }

      return await resp.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  static async testConnection(config: AzureDevOpsConfig): Promise<boolean> {
    try {
      await this.request(config, `${config.project}/_apis/wit/queries`, { method: 'GET' });
      return true;
    } catch {
      return false;
    }
  }

  static async searchWorkItems(
    config: AzureDevOpsConfig,
    query: string,
  ): Promise<AzureDevOpsWorkItem[]> {
    const sanitized = query.trim().replace(/[^a-zA-Z0-9\s\-_]/g, '');
    // Endpoint is project-scoped, so no need to filter by TeamProject
    const wiql = sanitized
      ? `SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '${sanitized}' ORDER BY [System.ChangedDate] DESC`
      : `SELECT [System.Id] FROM WorkItems WHERE [System.State] <> 'Closed' AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC`;

    const wiqlResult = (await this.request(config, `${config.project}/_apis/wit/wiql`, {
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
    return items[0];
  }

  static async postBranchComment(
    config: AzureDevOpsConfig,
    workItemId: number,
    branch: string,
  ): Promise<void> {
    const comment = `A task branch has been created for this work item:\n\n<code>${branch}</code>`;

    await this.request(config, `${config.project}/_apis/wit/workitems/${workItemId}`, {
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
      `${config.project}/_apis/wit/workitems?ids=${idsParam}${fields}${expand}`,
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
        const lastId = chain[chain.length - 1];
        if (!fetched.has(lastId)) idsToFetch.add(lastId);
      }
      // Remove already-fetched
      for (const id of allParentIds) idsToFetch.delete(id);
      if (idsToFetch.size === 0) break;

      try {
        // Fetch with relations expanded (cannot combine $expand with fields)
        const result = (await this.request(
          config,
          `${config.project}/_apis/wit/workitems?ids=${[...idsToFetch].join(',')}&$expand=relations`,
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
    return match ? parseInt(match[1], 10) : null;
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
      url: raw._links?.html?.href || `${baseUrl}/${config.project}/_workitems/edit/${raw.id}`,
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
