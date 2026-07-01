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
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Convert a git remote URL + branch name to a branch URL on the hosting provider */
export function branchUrl(remote: string, branch: string): string | null {
  const encodedBranch = encodeURIComponent(branch);

  // GitHub
  const ghSsh = remote.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (ghSsh) return `https://github.com/${ghSsh[1]}/tree/${encodedBranch}`;
  const ghHttps = remote.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (ghHttps) return `https://github.com/${ghHttps[1]}/tree/${encodedBranch}`;

  // ADO
  const ado = parseAdoRemote(remote);
  if (ado?.repository) {
    const base = ado.organizationUrl.replace(/\/+$/, '');
    return `${base}/${ado.project}/_git/${ado.repository}?version=GB${encodedBranch}`;
  }

  return null;
}

/** Check if a git remote URL points to an ADO repository */
export function isAdoRemote(remote: string | null): boolean {
  if (!remote) return false;
  return parseAdoRemote(remote) !== null;
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
