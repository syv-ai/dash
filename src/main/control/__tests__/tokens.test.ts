import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initTokens, tokenFor, verify, setOrchestratorFile } from '../tokens';
import { controlPaths } from '../paths';

let userData: string;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-tokens-'));
  initTokens(userData);
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

const orchestrator = { kind: 'orchestrator' } as const;
const task = { kind: 'task', taskId: '11111111-2222-3333-4444-555555555555' } as const;

describe('tokens', () => {
  it('round-trips a caller token', () => {
    expect(verify(tokenFor(orchestrator), orchestrator)).toBe(true);
    expect(verify(tokenFor(task), task)).toBe(true);
  });

  it("does not verify a task's token as the orchestrator or another task", () => {
    expect(verify(tokenFor(task), orchestrator)).toBe(false);
    expect(verify(tokenFor(task), { kind: 'task', taskId: 'other' })).toBe(false);
  });

  it('rejects tokens of the wrong length or junk', () => {
    expect(verify('', orchestrator)).toBe(false);
    expect(verify('abc', orchestrator)).toBe(false);
    expect(verify(tokenFor(orchestrator) + '00', orchestrator)).toBe(false);
  });

  it('writes the secret 0600 and keeps it across a re-init', () => {
    const { secret } = controlPaths(userData);
    expect(fs.statSync(secret).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(secret, 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    const before = tokenFor(task);
    initTokens(userData);
    expect(tokenFor(task)).toBe(before);
  });

  it('a different secret mints different tokens', () => {
    const before = tokenFor(task);
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-tokens-'));
    try {
      initTokens(other);
      expect(tokenFor(task)).not.toBe(before);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('writes and removes the orchestrator token file (0600)', () => {
    const file = controlPaths(userData).orchestratorToken;
    setOrchestratorFile(true);
    expect(fs.readFileSync(file, 'utf8').trim()).toBe(tokenFor(orchestrator));
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    setOrchestratorFile(false);
    expect(fs.existsSync(file)).toBe(false);
  });
});
