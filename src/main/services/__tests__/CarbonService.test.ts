import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';

// jsonlParser.getProjectsDir() resolves ~/.claude/projects via os.homedir(); point
// it at a throwaway temp dir so the scan reads our fixtures instead of the real home.
const mocked = vi.hoisted(() => ({ home: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => mocked.home };
});

import { computeCarbonStats } from '../CarbonService';
import { encodeProjectPath } from '../../utils/jsonlParser';

// Exercises computeCarbonStats's load-bearing branches:
//   - a defined-but-empty path list means "nothing matches" (NOT "scan everything")
//   - scoping restricts the scan to the encoded folders for the given paths
//   - the per-project label is the path basename, not the lossy decoded folder
//   - projects are sorted by descending energy, and zero-token folders are dropped
//   - an unreadable/garbage session file is skipped without aborting the scan

const PROJ_A = '/tmp/dash-test/projectA';
const PROJ_B = '/tmp/dash-test/projectB';
const PROJ_EMPTY = '/tmp/dash-test/projectEmpty';

/** A single assistant session line as Claude Code writes it. */
function sessionLine(uuid: string, model: string, inputTokens: number): string {
  return JSON.stringify({
    uuid,
    type: 'assistant',
    requestId: uuid,
    message: { role: 'assistant', model, usage: { input_tokens: inputTokens, output_tokens: 0 } },
  });
}

function writeSession(projectPath: string, file: string, lines: string[]): void {
  const folder = path.join(mocked.home, '.claude', 'projects', encodeProjectPath(projectPath));
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, file), lines.join('\n'));
}

beforeEach(() => {
  mocked.home = mkdtempSync(path.join(os.tmpdir(), 'dash-carbon-'));

  // projectA: opus-heavy → more energy than sonnet projectB.
  writeSession(PROJ_A, 'a.jsonl', [sessionLine('a1', 'claude-opus-4-8', 1000)]);
  // projectB: sonnet, fewer tokens.
  writeSession(PROJ_B, 'b.jsonl', [sessionLine('b1', 'claude-sonnet-4-6', 200)]);
  // projectEmpty: a file with no usage-bearing lines → 0 tokens, must be dropped.
  writeSession(PROJ_EMPTY, 'e.jsonl', ['not json', '{"uuid":"e1","type":"user"}']);
});

afterEach(() => {
  rmSync(mocked.home, { recursive: true, force: true });
});

describe('computeCarbonStats', () => {
  it('returns empty for a defined-but-empty path list (does not scan everything)', () => {
    const stats = computeCarbonStats([]);
    expect(stats.tokens).toBe(0);
    expect(stats.sessionCount).toBe(0);
    expect(stats.projects).toEqual([]);
  });

  it('scopes the scan to the encoded folders for the given paths', () => {
    const stats = computeCarbonStats([PROJ_A]);
    expect(stats.projects).toHaveLength(1);
    expect(stats.tokensByModel.opus).toBe(1000);
    expect(stats.tokensByModel.sonnet).toBe(0);
  });

  it('labels each project with the path basename, not the lossy decoded folder', () => {
    const stats = computeCarbonStats([PROJ_A]);
    expect(stats.projects[0].project).toBe('projectA');
  });

  it('scans every folder when no paths are given', () => {
    const scoped = computeCarbonStats([PROJ_A]);
    const all = computeCarbonStats();
    expect(all.sessionCount).toBeGreaterThan(scoped.sessionCount);
    expect(all.tokens).toBeGreaterThan(scoped.tokens);
  });

  it('sorts projects by descending energy and drops zero-token folders', () => {
    const stats = computeCarbonStats([PROJ_A, PROJ_B, PROJ_EMPTY]);
    expect(stats.projects.map((p) => p.project)).toEqual(['projectA', 'projectB']);
    expect(stats.projects[0].energyWh).toBeGreaterThan(stats.projects[1].energyWh);
  });

  it('counts the unreadable/garbage session file without aborting the scan', () => {
    // projectEmpty's file is unparseable but must not throw or drop the others.
    const stats = computeCarbonStats([PROJ_A, PROJ_B, PROJ_EMPTY]);
    expect(stats.tokens).toBe(1200);
    expect(stats.sessionCount).toBe(3); // all three files were read
  });
});
