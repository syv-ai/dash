import type { WorkspacePorts } from './WorkspacePortsService';

const DEFAULT_SLOTS = 50;
const DEFAULT_STRIDE = 100;

/**
 * djb2 hash mod slots, multiplied by stride. Same worktree name → same
 * offset across machines and Dash restarts, which is the whole point of the
 * deterministic strategy: developers can share screenshots/logs without
 * "what port is the frontend on for you?" friction.
 */
export function hashOffset(name: string, slots: number, stride: number): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = (h << 5) + h + name.charCodeAt(i);
    h = h | 0; // keep within 32-bit signed range
  }
  return (Math.abs(h) % slots) * stride;
}

/** Where a host port ultimately came from. Surfaced in tooltips. */
export type PortSource = 'fixed' | 'hash' | 'override' | 'probe';

export interface PortAssignment {
  label: string;
  hostPort: number;
  source: PortSource;
  /** Tier 2 only — the env var to inject. */
  envVar?: string;
  /** Tier 2 only — the defaultPort the assignment was derived from. */
  defaultPort?: number;
}

export interface AllocatePortsArgs {
  ports: WorkspacePorts;
  worktreeName: string;
  overrides: Record<string, number>;
  /**
   * Host ports already in use by other live workspaces. The allocator skips
   * past any of these by adding successive `stride`s to the candidate.
   */
  taken: Set<number>;
}

const MAX_PORT = 65535;
// Where the wrap-around fallback scan starts — below this is the privileged
// range, which a hash-derived assignment should never land in.
const DYNAMIC_FLOOR = 1024;

export function allocatePorts(args: AllocatePortsArgs): PortAssignment[] {
  const slots = args.ports.slots ?? DEFAULT_SLOTS;
  const stride = args.ports.stride ?? DEFAULT_STRIDE;
  const offset = hashOffset(args.worktreeName, slots, stride);

  const assignments: PortAssignment[] = [];

  // Ports claimed within THIS allocation run. Pre-seeded with every fixed
  // port and override pin (regardless of declaration order) so a hash/probe
  // candidate can't land on a sibling entry — `args.taken` only covers other
  // tasks' DB rows.
  const usedThisRun = new Set<number>();
  for (const entry of args.ports.ports) {
    if ('port' in entry) {
      usedThisRun.add(entry.port);
    } else if (args.overrides[entry.envVar] !== undefined) {
      usedThisRun.add(args.overrides[entry.envVar]);
    }
  }
  const isFree = (p: number) => p <= MAX_PORT && !args.taken.has(p) && !usedThisRun.has(p);

  for (const entry of args.ports.ports) {
    if ('port' in entry) {
      assignments.push({ label: entry.label, hostPort: entry.port, source: 'fixed' });
      continue;
    }

    const override = args.overrides[entry.envVar];
    if (override !== undefined) {
      // User pins win as-is; collisions with a pin are the user's call.
      assignments.push({
        label: entry.label,
        envVar: entry.envVar,
        defaultPort: entry.defaultPort,
        hostPort: override,
        source: 'override',
      });
      continue;
    }

    let candidate = entry.defaultPort + offset;
    let source: PortSource = 'hash';
    if (!isFree(candidate)) {
      source = 'probe';
      // Walk up by stride first — keeps assignments aligned to the slot grid.
      let c = candidate + stride;
      while (c <= MAX_PORT && !isFree(c)) c += stride;
      if (c > MAX_PORT) {
        // Ran off the end of the port range — linear scan from the default,
        // wrapping to the dynamic floor. With <65k assignments per run this
        // always terminates with a free port.
        c = entry.defaultPort;
        while (c <= MAX_PORT && !isFree(c)) c++;
        if (c > MAX_PORT) {
          c = DYNAMIC_FLOOR;
          while (c <= MAX_PORT && !isFree(c)) c++;
          // Every port in [1024, 65535] taken — can't happen in practice;
          // fall back to the default and let bind-time surface the clash.
          if (c > MAX_PORT) c = entry.defaultPort;
        }
      }
      candidate = c;
    }
    usedThisRun.add(candidate);
    assignments.push({
      label: entry.label,
      envVar: entry.envVar,
      defaultPort: entry.defaultPort,
      hostPort: candidate,
      source,
    });
  }

  return assignments;
}
