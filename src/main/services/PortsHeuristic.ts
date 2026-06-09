import * as fs from 'fs';
import * as path from 'path';

export interface PortGuess {
  /** Display name we'd put in the ports panel — also the proposed JSON `label`. */
  label: string;
  /** Suggested env var name, screaming snake case. */
  envVar: string;
  /** Default port we think the service binds to today; the allocator hashes from here. */
  defaultPort: number;
}

export interface HeuristicResult {
  needsPorts: boolean;
  /** Human-readable list of what triggered the result, e.g. "vite (package.json)",
   *  "docker-compose.yml: api, web". Surfaced in the panel's onboarding card so
   *  the user can sanity-check the detection before agreeing to set it up. */
  signals: string[];
  guesses: PortGuess[];
}

// Framework markers: presence of one of these in package.json /
// pyproject.toml etc. is enough to trip the onboarding affordance, but we
// don't auto-suggest port numbers off framework defaults. Vite's default is
// 5173 but the project may override it (Dash itself does — :3000); FastAPI's
// default is 8000 but uvicorn can bind anywhere. The agent reads the actual
// project files during setup to find the real port, which is more reliable
// than us guessing.
const NODE_FRONTEND_FRAMEWORKS = [
  'vite',
  'next',
  'nuxt',
  'astro',
  '@remix-run/dev',
  'react-scripts',
  '@sveltejs/kit',
  'webpack-dev-server',
  'parcel',
] as const;

const PYTHON_BACKEND_FRAMEWORKS = [
  'fastapi',
  'uvicorn',
  'starlette',
  'django',
  'flask',
  'sanic',
  'aiohttp',
] as const;

// Compose splits its config across multiple files by convention: the base
// file (production topology) and an override (dev `ports:` mappings live
// here). We scan both, then merge — override wins per service. Without
// this, projects following the canonical pattern look "no published ports"
// to the heuristic even though their dev ports are right there in the
// override file.
const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'docker-compose.override.yml',
  'docker-compose.override.yaml',
  'compose.override.yml',
  'compose.override.yaml',
  'docker-compose.dev.yml',
  'docker-compose.dev.yaml',
  'docker-compose.debug.yml',
  'docker-compose.debug.yaml',
  'docker-compose.local.yml',
  'docker-compose.local.yaml',
];

const ENV_VAR_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

function safeRead(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    // Cap reads so a bogus 50MB file in the project root can't stall the scan.
    if (stat.size > 512 * 1024) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function detectComposeServices(content: string): Array<{ service: string; port: number }> {
  // Tiny indent-aware scanner — full YAML parsing is overkill for "list the
  // service names and their first published port." We track which top-level
  // key we're inside (`services:` only), pick up child keys whose indent is
  // exactly one level deeper, then capture the first `NNNN:NNNN` or `NNNN`
  // line inside the service's `ports:` block.
  const lines = content.split(/\r?\n/);
  const results: Array<{ service: string; port: number }> = [];

  let inServices = false;
  let servicesIndent = -1;
  let currentService: string | null = null;
  let currentServiceIndent = -1;
  let inPortsBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;

    if (!inServices) {
      if (/^services\s*:/.test(trimmed)) {
        inServices = true;
        servicesIndent = indent;
      }
      continue;
    }

    if (indent <= servicesIndent && trimmed.length > 0) {
      // Left the services block entirely.
      inServices = false;
      currentService = null;
      inPortsBlock = false;
      continue;
    }

    // New service key (direct child of services:)
    if (currentService === null || indent <= currentServiceIndent) {
      const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
      if (match) {
        currentService = match[1];
        currentServiceIndent = indent;
        inPortsBlock = false;
      }
      continue;
    }

    if (/^ports\s*:/.test(trimmed)) {
      inPortsBlock = true;
      continue;
    }

    // Anything else at the service's own keys level closes the ports block.
    if (indent <= currentServiceIndent + 2 && !trimmed.startsWith('-')) {
      inPortsBlock = false;
    }

    if (inPortsBlock && trimmed.startsWith('-') && currentService) {
      const portMatch = trimmed.match(/(\d{2,5})(?::\d{2,5})?(?:\/(?:tcp|udp))?["']?\s*$/);
      if (portMatch) {
        const port = parseInt(portMatch[1], 10);
        if (port >= 1024 && port <= 65535) {
          results.push({ service: currentService, port });
          // One port per service is enough for the guesses — additional ones
          // are usually the same service on a second protocol and would just
          // clutter the onboarding card.
          inPortsBlock = false;
        }
      }
    }
  }
  return results;
}

function detectDockerfileExpose(content: string): number[] {
  const ports: number[] = [];
  for (const match of content.matchAll(/^\s*EXPOSE\s+([^\n#]+)/gim)) {
    for (const token of match[1].split(/\s+/)) {
      const portStr = token.split('/')[0];
      const port = parseInt(portStr, 10);
      if (Number.isInteger(port) && port >= 1024 && port <= 65535) ports.push(port);
    }
  }
  return ports;
}

function detectNodeFramework(packageJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const pkg = parsed as Record<string, unknown>;
  const deps = {
    ...(pkg.dependencies as Record<string, unknown> | undefined),
    ...(pkg.devDependencies as Record<string, unknown> | undefined),
  };
  for (const name of NODE_FRONTEND_FRAMEWORKS) {
    if (deps[name]) return name;
  }
  return null;
}

function detectPythonFramework(content: string): string | null {
  const lower = content.toLowerCase();
  for (const name of PYTHON_BACKEND_FRAMEWORKS) {
    // Word boundary so "django-extensions" still matches but "fastapilike"
    // doesn't trip "fastapi".
    const re = new RegExp(`(^|[^a-z0-9_-])${name}([^a-z0-9_-]|$)`);
    if (re.test(lower)) return name;
  }
  return null;
}

function uniqueGuesses(guesses: PortGuess[]): PortGuess[] {
  const byEnvVar = new Map<string, PortGuess>();
  for (const g of guesses) {
    if (!ENV_VAR_PATTERN.test(g.envVar)) continue;
    if (!byEnvVar.has(g.envVar)) byEnvVar.set(g.envVar, g);
  }
  return Array.from(byEnvVar.values());
}

function envVarFromService(service: string): string {
  const cleaned = service.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  const stripped = cleaned.replace(/^_+|_+$/g, '');
  const safe = stripped.length === 0 ? 'SERVICE' : stripped;
  const leading = /^[A-Z_]/.test(safe) ? safe : `_${safe}`;
  return `${leading}_PORT`;
}

function titleCase(service: string): string {
  return service
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Scan a project root (or worktree) for signals that per-worktree port
 * management would benefit it. Pure file system — no spawning. Returns
 * `needsPorts: false` and an empty guesses list when nothing trips, so the
 * caller can render the existing "no panel" state without special-casing.
 */
export function detectPortsNeed(projectPath: string): HeuristicResult {
  const signals: string[] = [];
  const guesses: PortGuess[] = [];

  // Merge published ports across base + override files. A service's port
  // is taken from the LAST file that publishes it (override wins, matching
  // how `docker compose up` resolves config).
  const composeServices = new Map<string, number>();
  const composeFilesSeen: string[] = [];
  for (const file of COMPOSE_FILES) {
    const content = safeRead(path.join(projectPath, file));
    if (!content) continue;
    composeFilesSeen.push(file);
    for (const { service, port } of detectComposeServices(content)) {
      composeServices.set(service, port);
    }
  }
  if (composeFilesSeen.length > 0) {
    if (composeServices.size === 0) {
      signals.push(`${composeFilesSeen.join(', ')} (no published ports)`);
    } else {
      signals.push(
        `${composeFilesSeen.join(' + ')}: ${Array.from(composeServices.keys()).join(', ')}`,
      );
      for (const [service, port] of composeServices) {
        guesses.push({
          label: titleCase(service),
          envVar: envVarFromService(service),
          defaultPort: port,
        });
      }
    }
  }

  // Detect existing bespoke per-worktree port allocators so the agent
  // doesn't walk into the conflict blind. Common pattern: dev.sh hashing
  // the worktree name (cksum / md5sum / sha + arithmetic) and exporting
  // OFFSET-based env vars. Surface as a signal — the slash command body
  // tells the agent how to handle it (isolate + remove the port-hashing
  // block, preserve the rest).
  const BESPOKE_SCRIPT_FILES = ['dev.sh', 'start.sh', 'run.sh', 'scripts/dev.sh', 'bin/dev'];
  // Check the two ingredients independently — the order they appear in the
  // file varies (\`WORKTREE_NAME | cksum\` vs \`cksum <<< $worktree\`), so
  // requiring "hash tool then worktree ref" in the same regex misses real
  // allocators. Either ingredient alone is also too noisy: a script can
  // mention \`basename\` for unrelated reasons; a script can call \`md5sum\`
  // on assets. Both ingredients present together is the actual signal.
  const HASH_TOOLS = /\b(cksum|md5sum|shasum|sha1sum|sha256sum)\b/;
  const WORKTREE_REFS = /\b(worktree|basename|\$PWD)\b/i;
  const OFFSET_PATTERN = /\b(PORT_OFFSET|HASH_OFFSET|WORKTREE_OFFSET)\b/;
  for (const file of BESPOKE_SCRIPT_FILES) {
    const content = safeRead(path.join(projectPath, file));
    if (!content) continue;
    const hasHashAndWorktree = HASH_TOOLS.test(content) && WORKTREE_REFS.test(content);
    if (hasHashAndWorktree || OFFSET_PATTERN.test(content)) {
      signals.push(`existing bespoke port allocator in ${file}`);
      break;
    }
  }

  const dockerfile = safeRead(path.join(projectPath, 'Dockerfile'));
  if (dockerfile) {
    const exposed = detectDockerfileExpose(dockerfile);
    if (exposed.length > 0) {
      signals.push(`Dockerfile EXPOSE ${exposed.join(', ')}`);
      // EXPOSE alone isn't enough to label a service confidently — the agent
      // will name it during setup. Skip auto-guesses here to avoid generic
      // "Service" rows masking the real names from compose / framework files.
    } else {
      signals.push('Dockerfile (no EXPOSE)');
    }
  }

  const pkg = safeRead(path.join(projectPath, 'package.json'));
  if (pkg) {
    const framework = detectNodeFramework(pkg);
    if (framework) signals.push(`${framework} (package.json)`);
  }

  for (const file of ['pyproject.toml', 'requirements.txt', 'Pipfile']) {
    const content = safeRead(path.join(projectPath, file));
    if (!content) continue;
    const framework = detectPythonFramework(content);
    if (framework) {
      signals.push(`${framework} (${file})`);
      break;
    }
  }

  const needsPorts = signals.length > 0;
  return {
    needsPorts,
    signals,
    guesses: uniqueGuesses(guesses),
  };
}
