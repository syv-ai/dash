import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadWorkspacePorts, loadPortOverrides } from '../WorkspacePortsService';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-ports-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJson(rel: string, value: unknown): void {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(value, null, 2));
}

describe('loadWorkspacePorts — basic parsing', () => {
  it('returns null when no .dash/ports.json exists', () => {
    expect(loadWorkspacePorts(tmpDir)).toBeNull();
  });

  it('parses a Tier 2 entry (envVar + defaultPort)', () => {
    writeJson('.dash/ports.json', {
      ports: [{ label: 'Frontend', envVar: 'FRONTEND_PORT', defaultPort: 5173 }],
    });
    expect(loadWorkspacePorts(tmpDir)).toEqual({
      ports: [{ label: 'Frontend', envVar: 'FRONTEND_PORT', defaultPort: 5173 }],
    });
  });

  it('parses a Tier 1 entry (fixed port)', () => {
    writeJson('.dash/ports.json', {
      ports: [{ label: 'Playwright Report', port: 9323 }],
    });
    expect(loadWorkspacePorts(tmpDir)).toEqual({
      ports: [{ label: 'Playwright Report', port: 9323 }],
    });
  });

  it('parses optional slots and stride', () => {
    writeJson('.dash/ports.json', {
      slots: 25,
      stride: 200,
      ports: [{ label: 'F', envVar: 'F_PORT', defaultPort: 3000 }],
    });
    expect(loadWorkspacePorts(tmpDir)).toEqual({
      slots: 25,
      stride: 200,
      ports: [{ label: 'F', envVar: 'F_PORT', defaultPort: 3000 }],
    });
  });
});

describe('loadWorkspacePorts — validation', () => {
  it('returns null when JSON is malformed', () => {
    const abs = path.join(tmpDir, '.dash', 'ports.json');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '{ not json');
    expect(loadWorkspacePorts(tmpDir)).toBeNull();
  });

  it('returns null when ports is missing', () => {
    writeJson('.dash/ports.json', {});
    expect(loadWorkspacePorts(tmpDir)).toBeNull();
  });

  it('returns null when ports is not an array', () => {
    writeJson('.dash/ports.json', { ports: 'oops' });
    expect(loadWorkspacePorts(tmpDir)).toBeNull();
  });

  it('returns null when an entry has both port and envVar', () => {
    writeJson('.dash/ports.json', {
      ports: [{ label: 'Mixed', port: 3000, envVar: 'X_PORT', defaultPort: 3000 }],
    });
    expect(loadWorkspacePorts(tmpDir)).toBeNull();
  });

  it('returns null when envVar is lowercase', () => {
    writeJson('.dash/ports.json', {
      ports: [{ label: 'X', envVar: 'frontend_port', defaultPort: 5173 }],
    });
    expect(loadWorkspacePorts(tmpDir)).toBeNull();
  });

  it('returns null when defaultPort is below 1024', () => {
    writeJson('.dash/ports.json', {
      ports: [{ label: 'X', envVar: 'X_PORT', defaultPort: 80 }],
    });
    expect(loadWorkspacePorts(tmpDir)).toBeNull();
  });

  it('returns null when defaultPort is above 65535', () => {
    writeJson('.dash/ports.json', {
      ports: [{ label: 'X', envVar: 'X_PORT', defaultPort: 99999 }],
    });
    expect(loadWorkspacePorts(tmpDir)).toBeNull();
  });

  it('returns null when two entries share an envVar', () => {
    writeJson('.dash/ports.json', {
      ports: [
        { label: 'A', envVar: 'X_PORT', defaultPort: 3000 },
        { label: 'B', envVar: 'X_PORT', defaultPort: 4000 },
      ],
    });
    expect(loadWorkspacePorts(tmpDir)).toBeNull();
  });

  it('returns null when slots is zero', () => {
    writeJson('.dash/ports.json', {
      slots: 0,
      ports: [{ label: 'X', envVar: 'X_PORT', defaultPort: 3000 }],
    });
    expect(loadWorkspacePorts(tmpDir)).toBeNull();
  });

  it('returns null when label is empty', () => {
    writeJson('.dash/ports.json', {
      ports: [{ label: '   ', envVar: 'X_PORT', defaultPort: 3000 }],
    });
    expect(loadWorkspacePorts(tmpDir)).toBeNull();
  });
});

describe('loadPortOverrides', () => {
  it('returns an empty map when no .dash/ports.local.json exists', () => {
    expect(loadPortOverrides(tmpDir)).toEqual({});
  });

  it('parses { overrides: { ... } } into a map', () => {
    writeJson('.dash/ports.local.json', {
      overrides: { FRONTEND_PORT: 5173, BACKEND_PORT: 8000 },
    });
    expect(loadPortOverrides(tmpDir)).toEqual({
      FRONTEND_PORT: 5173,
      BACKEND_PORT: 8000,
    });
  });

  it('drops entries whose envVar is invalid', () => {
    writeJson('.dash/ports.local.json', {
      overrides: { lower_case: 5173, GOOD_PORT: 3000 },
    });
    expect(loadPortOverrides(tmpDir)).toEqual({ GOOD_PORT: 3000 });
  });

  it('drops entries whose value is not a valid port', () => {
    writeJson('.dash/ports.local.json', {
      overrides: { OK_PORT: 3000, BAD_PORT: 80, NEG_PORT: -1, STR_PORT: '5173' },
    });
    expect(loadPortOverrides(tmpDir)).toEqual({ OK_PORT: 3000 });
  });

  it('returns empty map for malformed JSON', () => {
    const abs = path.join(tmpDir, '.dash', 'ports.local.json');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '{ not json');
    expect(loadPortOverrides(tmpDir)).toEqual({});
  });
});
