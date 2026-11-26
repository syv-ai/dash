import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listPlainFolder } from '../plainFolder';

describe('listPlainFolder', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'plain-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lists every file, and the folders no file implies', async () => {
    writeFileSync(path.join(root, 'notes.md'), '');
    mkdirSync(path.join(root, 'out/deep'), { recursive: true });
    writeFileSync(path.join(root, 'out/deep/a.json'), '');
    mkdirSync(path.join(root, 'empty'));
    mkdirSync(path.join(root, '.git'));
    symlinkSync(path.join(root, 'out'), path.join(root, 'linked'));
    expect(await listPlainFolder(root)).toEqual({
      files: ['notes.md', 'out/deep/a.json'],
      dirs: ['empty', 'linked'],
    });
  });

  it('stops descending past the cap, leaving the rest to list when opened', async () => {
    mkdirSync(path.join(root, 'a/b'), { recursive: true });
    writeFileSync(path.join(root, 'a/b/f'), '');
    writeFileSync(path.join(root, 'top'), '');
    expect(await listPlainFolder(root, 2)).toEqual({ files: ['top'], dirs: ['a'] });
  });
});
