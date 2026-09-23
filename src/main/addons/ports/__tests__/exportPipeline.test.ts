import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadWorkspacePorts } from '../WorkspacePortsService';
import { hashOffset, allocatePorts } from '../PortAllocator';
import { composeWorktreeEnv, formatEnvExport } from '../derivedEnv';

// End-to-end check of the export composition the runtime performs: parse
// ports.json → allocate (real hash) → compose ports + derived → render the
// sourceable file. Mirrors WorkspacePortsRuntime.writeExportFile without the DB
// so the parse/allocate/resolve/format chain is verified against a real
// FastAPI+Vite-style config on disk.

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-export-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('export file pipeline', () => {
  it('renders allocated ports + resolved derived vars into a sourceable file', () => {
    fs.mkdirSync(path.join(tmpDir, '.dash'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.dash', 'ports.json'),
      JSON.stringify({
        ports: [
          { label: 'Frontend', envVar: 'FRONTEND_PORT', defaultPort: 5173 },
          { label: 'Backend', envVar: 'BACKEND_PORT', defaultPort: 8000 },
          { label: 'Adminer', port: 8080 },
        ],
        derived: {
          VITE_API_URL: 'http://localhost:${BACKEND_PORT}',
          BACKEND_CORS_ORIGINS: 'http://localhost:${FRONTEND_PORT},http://localhost',
        },
      }),
    );

    const config = loadWorkspacePorts(tmpDir)!;
    const offset = hashOffset('feature-auth', 50, 100);
    const assignments = allocatePorts({
      ports: config,
      worktreeName: 'feature-auth',
      overrides: {},
      taken: new Set(),
    });

    const portEntries = assignments
      .filter((a) => a.envVar)
      .map((a) => [a.envVar!, a.hostPort] as [string, number]);
    const file = formatEnvExport(composeWorktreeEnv(portEntries, config.derived));

    const fePort = 5173 + offset;
    const bePort = 8000 + offset;
    // Allocated ports, not defaults.
    expect(file).toContain(`export FRONTEND_PORT='${fePort}'`);
    expect(file).toContain(`export BACKEND_PORT='${bePort}'`);
    // Derived vars composed from the SAME allocated ports.
    expect(file).toContain(`export VITE_API_URL='http://localhost:${bePort}'`);
    expect(file).toContain(
      `export BACKEND_CORS_ORIGINS='http://localhost:${fePort},http://localhost'`,
    );
    // Fixed (Tier-1) ports have no env var → not exported.
    expect(file).not.toContain('ADMINER');
    // Sourceable.
    expect(file.trimStart().startsWith('#')).toBe(true);
  });
});
