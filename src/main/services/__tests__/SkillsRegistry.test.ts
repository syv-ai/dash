import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';

// app.getPath('userData') drives where the registry file lives.
let userData: string;
vi.mock('electron', () => ({
  default: {},
  app: { getPath: () => userData },
}));

import {
  getRegistryEntry,
  setSkillSource,
  setSkillCustom,
  removeRegistryEntry,
  __resetSkillsRegistryForTest,
} from '../SkillsRegistry';

const DIR = '/some/abs/.claude/skills/demo';
const SOURCE = { repo: 'owner/repo', branch: 'main', path: 'skills/demo', installedAt: 5 };
const CUSTOM = { contentSha256: 'abc123', checkedAt: 99 };

beforeEach(() => {
  userData = mkdtempSync(path.join(os.tmpdir(), 'dash-registry-test-'));
  __resetSkillsRegistryForTest();
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe('SkillsRegistry', () => {
  it('round-trips a source binding, persisted to a single app-data file', () => {
    setSkillSource(DIR, SOURCE);
    expect(getRegistryEntry(DIR)?.source).toEqual(SOURCE);
    // One file under the app-data dir — nothing written into the skill folder.
    expect(existsSync(path.join(userData, 'skills-registry.json'))).toBe(true);
  });

  it('round-trips a custom record', () => {
    setSkillCustom(DIR, CUSTOM);
    expect(getRegistryEntry(DIR)?.custom).toEqual(CUSTOM);
  });

  it('binding a source clears any prior custom record', () => {
    setSkillCustom(DIR, CUSTOM);
    setSkillSource(DIR, SOURCE);
    const entry = getRegistryEntry(DIR);
    expect(entry?.source).toEqual(SOURCE);
    expect(entry?.custom).toBeUndefined();
  });

  it('removeRegistryEntry drops the entry', () => {
    setSkillSource(DIR, SOURCE);
    removeRegistryEntry(DIR);
    expect(getRegistryEntry(DIR)).toBeUndefined();
  });

  it('a missing registry file reads as empty (no throw)', () => {
    expect(getRegistryEntry('/never/written')).toBeUndefined();
  });
});
