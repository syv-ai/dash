import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../atomicWrite';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-atomic-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('replaces the file and leaves no tmp file behind', () => {
    const file = path.join(dir, 'a.json');
    fs.writeFileSync(file, 'old');
    writeFileAtomic(file, 'new');
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
    expect(fs.readdirSync(dir)).toEqual(['a.json']);
  });

  it.runIf(process.platform !== 'win32')('applies the mode despite the umask', () => {
    const file = path.join(dir, 'run');
    const prev = process.umask(0o077);
    try {
      writeFileAtomic(file, '#!/bin/sh\n', { mode: 0o755 });
    } finally {
      process.umask(prev);
    }
    expect(fs.statSync(file).mode & 0o777).toBe(0o755);
  });

  it('cleans up the tmp file when the rename fails', () => {
    const target = path.join(dir, 'taken');
    fs.mkdirSync(path.join(target, 'child'), { recursive: true });
    expect(() => writeFileAtomic(target, 'x')).toThrow();
    expect(fs.readdirSync(dir)).toEqual(['taken']);
  });
});
