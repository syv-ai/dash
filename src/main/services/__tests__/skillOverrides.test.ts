import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readSkillOverrides, setSkillOverride } from '../skillOverrides';

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-so-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('readSkillOverrides', () => {
  it('returns {} when the settings file is missing', () => {
    expect(readSkillOverrides(path.join(tmp(), '.claude', 'settings.json'))).toEqual({});
  });
  it('reads an existing skillOverrides map', () => {
    const f = path.join(tmp(), 'settings.json');
    fs.writeFileSync(f, JSON.stringify({ skillOverrides: { deploy: 'off' } }));
    expect(readSkillOverrides(f)).toEqual({ deploy: 'off' });
  });
});

describe('setSkillOverride', () => {
  it('creates the file + dirs and writes the override', () => {
    const f = path.join(tmp(), '.claude', 'settings.json');
    setSkillOverride(f, 'deploy', 'off');
    expect(JSON.parse(fs.readFileSync(f, 'utf-8'))).toEqual({ skillOverrides: { deploy: 'off' } });
  });
  it('preserves unrelated settings keys', () => {
    const f = path.join(tmp(), 'settings.json');
    fs.writeFileSync(f, JSON.stringify({ enabledPlugins: { 'a@b': true } }));
    setSkillOverride(f, 'deploy', 'name-only');
    expect(JSON.parse(fs.readFileSync(f, 'utf-8'))).toEqual({
      enabledPlugins: { 'a@b': true },
      skillOverrides: { deploy: 'name-only' },
    });
  });
  it('clears an override when visibility is null and prunes the empty map', () => {
    const f = path.join(tmp(), 'settings.json');
    fs.writeFileSync(f, JSON.stringify({ skillOverrides: { deploy: 'off' }, x: 1 }));
    setSkillOverride(f, 'deploy', null);
    expect(JSON.parse(fs.readFileSync(f, 'utf-8'))).toEqual({ x: 1 });
  });
  it('rejects an invalid visibility value', () => {
    const f = path.join(tmp(), 'settings.json');
    // @ts-expect-error testing runtime guard
    expect(() => setSkillOverride(f, 'deploy', 'bogus')).toThrow(/Invalid skill visibility/);
  });
});
