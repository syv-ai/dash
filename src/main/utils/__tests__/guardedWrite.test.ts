import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeFileIfUnchanged } from '../guardedWrite';

let tmp: string;
let file: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-guarded-'));
  file = path.join(tmp, 'a.txt');
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('writeFileIfUnchanged', () => {
  it('creates a file expected to be absent and reports its new stat', async () => {
    const result = await writeFileIfUnchanged(file, 'one', { mtimeMs: 0, sizeBytes: 0 });
    const stat = fs.statSync(file);
    expect(result).toEqual({ ok: true, mtimeMs: stat.mtimeMs, sizeBytes: 3 });
    expect(fs.readdirSync(tmp)).toEqual(['a.txt']);
  });

  it('refuses to create over a file that already exists', async () => {
    fs.writeFileSync(file, 'theirs');
    const result = await writeFileIfUnchanged(file, 'mine', { mtimeMs: 0, sizeBytes: 0 });
    expect(result).toMatchObject({ ok: false, stale: true, currentSizeBytes: 6 });
    expect(fs.readFileSync(file, 'utf8')).toBe('theirs');
  });

  it('writes when the file is as expected and reports stale when it is not', async () => {
    fs.writeFileSync(file, 'one');
    const stat = fs.statSync(file);
    const expected = { mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
    expect((await writeFileIfUnchanged(file, 'two!', expected)).ok).toBe(true);
    expect(await writeFileIfUnchanged(file, 'three', expected)).toMatchObject({
      ok: false,
      currentSizeBytes: 4,
    });
    expect(fs.readFileSync(file, 'utf8')).toBe('two!');
  });

  it('reports a deleted file as stale rather than recreating it', async () => {
    const result = await writeFileIfUnchanged(file, 'x', { mtimeMs: 5, sizeBytes: 1 });
    expect(result).toEqual({ ok: false, stale: true, currentMtimeMs: 0, currentSizeBytes: 0 });
    expect(fs.existsSync(file)).toBe(false);
  });
});
