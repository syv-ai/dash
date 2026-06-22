import { describe, it, expect } from 'vitest';
import { hashOffset, allocatePorts } from '../PortAllocator';
import type { WorkspacePorts } from '../WorkspacePortsService';

describe('hashOffset', () => {
  it('returns the same offset for the same input', () => {
    expect(hashOffset('feature-x', 50, 100)).toBe(hashOffset('feature-x', 50, 100));
  });

  it('stays within [0, slots * stride)', () => {
    for (const name of ['', 'a', 'feature-x', 'main', 'master', 'long-worktree-name-1234']) {
      const off = hashOffset(name, 50, 100);
      expect(off).toBeGreaterThanOrEqual(0);
      expect(off).toBeLessThan(50 * 100);
      expect(off % 100).toBe(0);
    }
  });

  it('different names usually give different offsets', () => {
    // Not a strict guarantee; just a smoke check that we're not collapsing
    // every input to zero.
    const offsets = new Set([
      hashOffset('alpha', 50, 100),
      hashOffset('beta', 50, 100),
      hashOffset('gamma', 50, 100),
      hashOffset('delta', 50, 100),
      hashOffset('epsilon', 50, 100),
    ]);
    expect(offsets.size).toBeGreaterThan(1);
  });
});

const tiered: WorkspacePorts = {
  ports: [
    { label: 'Frontend', envVar: 'FRONTEND_PORT', defaultPort: 5173 },
    { label: 'Backend', envVar: 'BACKEND_PORT', defaultPort: 8000 },
    { label: 'Playwright', port: 9323 },
  ],
};

describe('allocatePorts', () => {
  it('keeps fixed-port entries as-is', () => {
    const assignments = allocatePorts({
      ports: tiered,
      worktreeName: 'feature-x',
      overrides: {},
      taken: new Set(),
    });
    const playwright = assignments.find((a) => a.label === 'Playwright');
    expect(playwright).toEqual({ label: 'Playwright', hostPort: 9323, source: 'fixed' });
  });

  it('adds hashOffset to defaultPort for Tier 2 entries', () => {
    const offset = hashOffset('feature-x', 50, 100);
    const assignments = allocatePorts({
      ports: tiered,
      worktreeName: 'feature-x',
      overrides: {},
      taken: new Set(),
    });
    const frontend = assignments.find((a) => a.envVar === 'FRONTEND_PORT');
    expect(frontend).toEqual({
      label: 'Frontend',
      envVar: 'FRONTEND_PORT',
      defaultPort: 5173,
      hostPort: 5173 + offset,
      source: 'hash',
    });
  });

  it('honours overrides over hash assignment', () => {
    const assignments = allocatePorts({
      ports: tiered,
      worktreeName: 'feature-x',
      overrides: { FRONTEND_PORT: 5173 },
      taken: new Set(),
    });
    const frontend = assignments.find((a) => a.envVar === 'FRONTEND_PORT');
    expect(frontend?.hostPort).toBe(5173);
    expect(frontend?.source).toBe('override');
  });

  it('probes forward by stride when the hashed port collides', () => {
    const offset = hashOffset('feature-x', 50, 100);
    const colliding = 5173 + offset;
    const assignments = allocatePorts({
      ports: tiered,
      worktreeName: 'feature-x',
      overrides: {},
      taken: new Set([colliding]),
    });
    const frontend = assignments.find((a) => a.envVar === 'FRONTEND_PORT');
    expect(frontend?.hostPort).toBe(colliding + 100);
    expect(frontend?.source).toBe('probe');
  });

  it('probes past multiple consecutive collisions', () => {
    const offset = hashOffset('feature-x', 50, 100);
    const c1 = 5173 + offset;
    const c2 = c1 + 100;
    const c3 = c2 + 100;
    const assignments = allocatePorts({
      ports: tiered,
      worktreeName: 'feature-x',
      overrides: {},
      taken: new Set([c1, c2, c3]),
    });
    const frontend = assignments.find((a) => a.envVar === 'FRONTEND_PORT');
    expect(frontend?.hostPort).toBe(c3 + 100);
  });

  it('assigns distinct ports to two entries sharing a defaultPort', () => {
    const dup: WorkspacePorts = {
      ports: [
        { label: 'API', envVar: 'API_PORT', defaultPort: 3000 },
        { label: 'Worker', envVar: 'WORKER_PORT', defaultPort: 3000 },
      ],
    };
    const assignments = allocatePorts({
      ports: dup,
      worktreeName: 'feature-x',
      overrides: {},
      taken: new Set(),
    });
    expect(assignments[0]!.hostPort).not.toBe(assignments[1]!.hostPort);
    expect(assignments[1]!.source).toBe('probe');
  });

  it('hash candidate colliding with a fixed port in the same config probes past it', () => {
    const offset = hashOffset('feature-x', 50, 100);
    // Fixed entry deliberately listed AFTER the tier-2 entry — the allocator
    // must reserve fixed ports before resolving hash candidates.
    const ports: WorkspacePorts = {
      ports: [
        { label: 'Frontend', envVar: 'FRONTEND_PORT', defaultPort: 5173 },
        { label: 'Proxy', port: 5173 + offset },
      ],
    };
    const assignments = allocatePorts({
      ports,
      worktreeName: 'feature-x',
      overrides: {},
      taken: new Set(),
    });
    const frontend = assignments.find((a) => a.envVar === 'FRONTEND_PORT');
    expect(frontend?.hostPort).toBe(5173 + offset + 100);
    expect(frontend?.source).toBe('probe');
  });

  it('never allocates above 65535', () => {
    const ports: WorkspacePorts = {
      ports: [{ label: 'High', envVar: 'HIGH_PORT', defaultPort: 65535 }],
    };
    const assignments = allocatePorts({
      ports,
      worktreeName: 'feature-x',
      overrides: {},
      taken: new Set([65535]),
    });
    const high = assignments[0]!;
    expect(high.hostPort).toBeGreaterThanOrEqual(1);
    expect(high.hostPort).toBeLessThanOrEqual(65535);
    expect(high.hostPort).not.toBe(65535);
  });

  it('uses configured slots/stride from the ports config', () => {
    const customPorts: WorkspacePorts = {
      slots: 10,
      stride: 1000,
      ports: [{ label: 'X', envVar: 'X_PORT', defaultPort: 5000 }],
    };
    const offset = hashOffset('feature-x', 10, 1000);
    const assignments = allocatePorts({
      ports: customPorts,
      worktreeName: 'feature-x',
      overrides: {},
      taken: new Set(),
    });
    expect(assignments[0]!.hostPort).toBe(5000 + offset);
  });
});

describe('service command passthrough', () => {
  it('passes service command fields through to assignments', () => {
    const result = allocatePorts({
      ports: {
        ports: [
          { label: 'Web', envVar: 'WEB_PORT', defaultPort: 3000, run: 'pnpm dev', cwd: 'web' },
          {
            label: 'DB',
            port: 5432,
            stop: 'docker compose stop db',
            logs: 'docker compose logs -f db',
          },
        ],
      },
      worktreeName: 'wt-a',
      overrides: {},
      taken: new Set<number>(),
    });
    expect(result.find((a) => a.label === 'Web')).toMatchObject({ run: 'pnpm dev', cwd: 'web' });
    expect(result.find((a) => a.label === 'DB')).toMatchObject({
      stop: 'docker compose stop db',
      logs: 'docker compose logs -f db',
    });
  });
});
