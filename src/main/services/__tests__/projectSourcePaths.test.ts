import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '../../../shared/types';
import { expandUserPath, inspectPath } from '../projectSourcePaths';

function project(id: string, p: string, archived = false): Project {
  return {
    id,
    name: id,
    path: p,
    isGitRepo: true,
    gitRemote: null,
    gitBranch: null,
    baseRef: null,
    archivedAt: archived ? '2026-01-01' : null,
    createdAt: '',
    updatedAt: '',
  } as Project;
}

const noCheckout = () => null;

describe('expandUserPath', () => {
  it('expands ~ and normalises', () => {
    expect(expandUserPath('~', '/home/me')).toBe('/home/me');
    expect(expandUserPath(' ~/code/x/ ', '/home/me')).toBe('/home/me/code/x');
    expect(expandUserPath('/a/b/../c')).toBe('/a/c');
  });

  it('refuses a relative path', () => {
    expect(() => expandUserPath('code/x', '/home/me')).toThrow(/full path/);
  });
});

describe('inspectPath', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'inspect-')));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('tells a repo, a plain folder, a new folder and a file apart', () => {
    mkdirSync(path.join(root, 'repo/.git'), { recursive: true });
    mkdirSync(path.join(root, 'plain'));
    writeFileSync(path.join(root, 'file'), '');
    const at = (rel: string) => inspectPath(path.join(root, rel), [], { checkoutOf: noCheckout });

    expect(at('repo')).toMatchObject({ exists: true, isDirectory: true, isGitRepo: true });
    expect(at('plain')).toMatchObject({ exists: true, isDirectory: true, isGitRepo: false });
    expect(at('fresh')).toMatchObject({ exists: false, parentExists: true });
    expect(at('no/such')).toMatchObject({ exists: false, parentExists: false });
    expect(at('file')).toMatchObject({ exists: true, isDirectory: false });
  });

  it('echoes the input and expands ~', () => {
    mkdirSync(path.join(root, 'plain'));
    const facts = inspectPath(' ~/plain ', [], { home: root, checkoutOf: noCheckout });
    expect(facts.input).toBe('~/plain');
    expect(facts.path).toBe(path.join(root, 'plain'));
  });

  it('names the project the folder is or is inside', () => {
    mkdirSync(path.join(root, 'p/src'), { recursive: true });
    const projects = [project('p1', path.join(root, 'p'), true)];
    const opts = { checkoutOf: noCheckout };
    expect(inspectPath(path.join(root, 'p'), projects, opts).project).toEqual({
      id: 'p1',
      name: 'p1',
      relation: 'same',
      archived: true,
    });
    expect(inspectPath(path.join(root, 'p/src'), projects, opts).project?.relation).toBe('inside');
  });

  it('names the project a worktree belongs to', () => {
    mkdirSync(path.join(root, 'main'));
    mkdirSync(path.join(root, 'wt'));
    const projects = [project('p1', path.join(root, 'main'))];
    const facts = inspectPath(path.join(root, 'wt'), projects, {
      checkoutOf: () => path.join(root, 'main'),
    });
    expect(facts.project?.relation).toBe('worktree');
  });
});
