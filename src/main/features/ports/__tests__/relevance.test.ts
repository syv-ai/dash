import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { portsOnboardingRelevant } from '../relevance';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-relevance-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('portsOnboardingRelevant', () => {
  it('relevant when the worktree has no .dash/ports.json', () => {
    expect(portsOnboardingRelevant(dir)).toBe(true);
  });

  it('NOT relevant when .dash/ports.json already exists (project already set up)', () => {
    fs.mkdirSync(path.join(dir, '.dash'));
    fs.writeFileSync(path.join(dir, '.dash', 'ports.json'), '{"services":[]}');
    expect(portsOnboardingRelevant(dir)).toBe(false);
  });

  it('an empty .dash dir alone does not make it irrelevant', () => {
    fs.mkdirSync(path.join(dir, '.dash'));
    expect(portsOnboardingRelevant(dir)).toBe(true);
  });
});
