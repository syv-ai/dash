import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listPlainFolderFiles } from '../editorIpc';

describe('listPlainFolderFiles', () => {
  let dir: string;
  const write = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'x');
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-plain-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('lists the files of a folder git does not know, sorted, as tree paths', async () => {
    for (const rel of ['feedback_ci.md', 'MEMORY.md', 'archive/old.md']) write(rel);
    expect(await listPlainFolderFiles(dir)).toEqual([
      'MEMORY.md',
      'archive/old.md',
      'feedback_ci.md',
    ]);
  });

  it('stays out of .git and node_modules', async () => {
    for (const rel of ['a.md', '.git/config', 'node_modules/x/index.js']) write(rel);
    expect(await listPlainFolderFiles(dir)).toEqual(['a.md']);
  });

  it('is empty for an empty folder', async () => {
    expect(await listPlainFolderFiles(dir)).toEqual([]);
  });
});
