import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPortsWizard } from '../index';
import { getWizard } from '../../wizardRegistry';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-ports-complete-'));
  registerPortsWizard();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ports wizard isComplete', () => {
  it('not complete when the worktree has no .dash/ports.json', () => {
    expect(getWizard('ports')?.isComplete?.(dir)).toBe(false);
  });

  it('complete when .dash/ports.json already exists', () => {
    fs.mkdirSync(path.join(dir, '.dash'));
    fs.writeFileSync(path.join(dir, '.dash', 'ports.json'), '{"services":[]}');
    expect(getWizard('ports')?.isComplete?.(dir)).toBe(true);
  });
});
