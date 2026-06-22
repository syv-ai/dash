import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPortsWizard } from '../index';
import { getWizard, type RequestStartPayload } from '../../wizardRegistry';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-ports-relevant-'));
  registerPortsWizard();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function isRelevant(cwd: string): boolean {
  return getWizard('ports')!.isRelevant!({ cwd } as RequestStartPayload);
}

describe('ports wizard isRelevant', () => {
  it('not relevant for a project with no port-using services (avoids spawn-then-teardown)', () => {
    expect(isRelevant(dir)).toBe(false);
  });

  it('relevant when the heuristic detects ports and there is no ports.json yet', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { vite: '^5.0.0' } }),
    );
    expect(isRelevant(dir)).toBe(true);
  });

  it('not relevant once .dash/ports.json exists, even if the heuristic detects ports', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { vite: '^5.0.0' } }),
    );
    fs.mkdirSync(path.join(dir, '.dash'));
    fs.writeFileSync(path.join(dir, '.dash', 'ports.json'), '{"services":[]}');
    expect(isRelevant(dir)).toBe(false);
  });
});
