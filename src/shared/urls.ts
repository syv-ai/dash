/** Extract the `owner/repo` slug from a GitHub remote URL (SSH or HTTPS), or null. */
export function githubSlug(remote: string | null): string | null {
  if (!remote) return null;
  const ssh = remote.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return ssh[1]!;
  const https = remote.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (https) return https[1]!;
  return null;
}

/** Convert a git remote URL (SSH or HTTPS) to a GitHub issue URL */
export function githubIssueUrl(remote: string, num: number): string | null {
  const ssh = remote.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}/issues/${num}`;
  const https = remote.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (https) return `https://github.com/${https[1]}/issues/${num}`;
  return null;
}

/**
 * Parse ADO org URL, project name, and (when present) repo name from a git remote.
 * Returns null for non-ADO remotes.
 *
 * Real-world ADO remotes vary more than a rigid regex tolerates: HTTPS clone URLs
 * carry an `org@` userinfo prefix (`https://org@dev.azure.com/org/proj/_git/repo`,
 * the default from ADO's "Clone" dialog), and remotes can have a trailing slash or
 * `.git` suffix. The old end-anchored regexes rejected all of these and fell back
 * to a repo-less parse — enough for project-scoped work-item search to work, but
 * the PR badge and "From PR" list both need `repository`, so they silently failed.
 * Parse via the URL API (which discards userinfo) so those variants resolve.
 */
export function parseAdoRemote(
  remote: string,
): { organizationUrl: string; project: string; repository?: string } | null {
  const trimmed = remote
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');

  // SSH form: git@ssh.dev.azure.com:v3/{org}/{project}[/{repo}] — not a URL.
  const ssh = trimmed.match(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/);
  if (ssh) {
    return {
      organizationUrl: `https://dev.azure.com/${ssh[1]}`,
      project: decodeURIComponent(ssh[2]!),
      repository: ssh[3] ? decodeURIComponent(ssh[3]) : undefined,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // URL() parses (and drops) any `user@` userinfo into url.username, so an
  // `org@dev.azure.com` host resolves to the bare hostname here.
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean).map(safeDecode);

  // dev.azure.com/{org}/{project}[/_git/{repo}]
  if (host === 'dev.azure.com') {
    const [org, project, gitMarker, repo] = segments;
    if (!org || !project) return null;
    return {
      organizationUrl: `https://dev.azure.com/${org}`,
      project,
      repository: gitMarker === '_git' && repo ? repo : undefined,
    };
  }

  // {org}.visualstudio.com/{project}[/_git/{repo}] — org is the subdomain.
  const vs = host.match(/^([^.]+)\.visualstudio\.com$/);
  if (vs) {
    const [project, gitMarker, repo] = segments;
    if (!project) return null;
    return {
      organizationUrl: `https://dev.azure.com/${vs[1]}`,
      project,
      repository: gitMarker === '_git' && repo ? repo : undefined,
    };
  }

  return null;
}

/** decodeURIComponent that returns the input unchanged on malformed escapes. */
/**
 * The ADO project name as ADO knows it (spaces, not `%20`). Configs saved before
 * parseAdoRemote decoded its segments hold the encoded form (`AI%20og%20DT`),
 * which the service then encoded again into a path ADO answers with a bare 404.
 */
export function normalizeAdoProject(project: string): string {
  return safeDecode(project.trim());
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Where a repository lives on the web: its forge and its home page. */
export interface ForgeRepo {
  kind: 'github' | 'gitlab' | 'ado';
  /** The repository's page, no trailing slash: `https://github.com/o/r`. */
  webUrl: string;
}

/**
 * The forge repository a git remote points at, or null for a host Dash
 * doesn't know. Takes scp-style SSH (`git@host:o/r.git`), `ssh://` and
 * HTTPS remotes (with or without userinfo, `.git` or a trailing slash).
 * GitLab is gitlab.com or any host named `gitlab.*` (self-managed).
 */
export function parseForgeRepo(remote: string | null): ForgeRepo | null {
  if (!remote) return null;
  const ado = parseAdoRemote(remote);
  if (ado) {
    if (!ado.repository) return null;
    const enc = encodeURIComponent;
    return {
      kind: 'ado',
      webUrl: `${ado.organizationUrl}/${enc(ado.project)}/_git/${enc(ado.repository)}`,
    };
  }
  const loc = remoteLocation(remote);
  if (!loc) return null;
  const host = loc.host.toLowerCase();
  if (host === 'github.com') return { kind: 'github', webUrl: `https://github.com/${loc.path}` };
  if (host === 'gitlab.com' || host.startsWith('gitlab.')) {
    return { kind: 'gitlab', webUrl: `https://${host}/${loc.path}` };
  }
  return null;
}

/** A remote's host and repository path (`owner/repo`, no `.git`). */
function remoteLocation(remote: string): { host: string; path: string } | null {
  const trimmed = remote
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  const scp = trimmed.match(/^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/);
  if (scp) return { host: scp[1]!, path: scp[2]!.replace(/^\/+/, '') };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return null;
  const path = url.pathname.replace(/^\/+/, '');
  return path ? { host: url.hostname, path } : null;
}

/** A branch name in a URL path: each segment encoded, its slashes kept. */
function encodeRefPath(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/');
}

/** A branch's page on its forge. */
export function forgeBranchUrl(repo: ForgeRepo, branch: string): string {
  switch (repo.kind) {
    case 'github':
      return `${repo.webUrl}/tree/${encodeRefPath(branch)}`;
    case 'gitlab':
      return `${repo.webUrl}/-/tree/${encodeRefPath(branch)}`;
    case 'ado':
      return `${repo.webUrl}?version=GB${encodeURIComponent(branch)}`;
  }
}

/** A commit's page on its forge. */
export function forgeCommitUrl(repo: ForgeRepo, sha: string): string {
  return repo.kind === 'gitlab' ? `${repo.webUrl}/-/commit/${sha}` : `${repo.webUrl}/commit/${sha}`;
}

/** A GitHub login's profile page, for a GitHub remote; null elsewhere (ADO
 *  and GitLab name people by display name or need an API lookup). */
export function githubProfileUrl(remote: string | null, login: string): string | null {
  return parseForgeRepo(remote)?.kind === 'github' && login
    ? `https://github.com/${encodeURIComponent(login)}`
    : null;
}

/** Convert a git remote URL + branch name to a branch URL on the hosting provider */
export function branchUrl(remote: string, branch: string): string | null {
  const repo = parseForgeRepo(remote);
  return repo ? forgeBranchUrl(repo, branch) : null;
}

/** Check if a git remote URL points to an ADO repository */
export function isAdoRemote(remote: string | null): boolean {
  if (!remote) return false;
  return parseAdoRemote(remote) !== null;
}

/** Where a remote's PRs live: ADO for an Azure DevOps remote, else GitHub. */
export function providerForRemote(remote: string | null): 'github' | 'ado' {
  return remote && isAdoRemote(remote) ? 'ado' : 'github';
}

/** Get the display URL for a linked item */
export function linkedItemUrl(
  item: { provider: 'github' | 'ado'; id: number; url: string },
  remote: string | null,
): string | null {
  if (item.url) return item.url;
  if (item.provider === 'github' && remote) return githubIssueUrl(remote, item.id);
  return null;
}
