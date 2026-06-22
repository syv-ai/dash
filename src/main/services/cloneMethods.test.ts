import { describe, it, expect } from 'vitest';
import { CLONE_METHODS, getCloneMethod, buildSourceCommand } from './cloneMethods';

describe('clone methods registry', () => {
  it('has git as the first/default method, non-interactive', () => {
    expect(CLONE_METHODS[0]!.id).toBe('git');
    expect(getCloneMethod('git')!.interactive).toBe(false);
  });

  it('marks cookiecutter and copier interactive', () => {
    expect(getCloneMethod('cookiecutter')!.interactive).toBe(true);
    expect(getCloneMethod('copier')!.interactive).toBe(true);
  });

  it('returns undefined for an unknown id', () => {
    expect(getCloneMethod('svn')).toBeUndefined();
  });

  it('builds the git command with dest, detect=dest', () => {
    const cmd = buildSourceCommand('git', {
      url: 'https://github.com/u/repo.git',
      parentDir: '/tmp/p',
      name: 'repo',
    });
    expect(cmd).toEqual({
      command: ['git', 'clone', 'https://github.com/u/repo.git', '/tmp/p/repo'],
      cwd: '/tmp/p',
      detect: 'dest',
      dest: '/tmp/p/repo',
    });
  });

  it('builds cookiecutter to run in the parent dir, detect=diff', () => {
    const cmd = buildSourceCommand('cookiecutter', {
      url: 'gh:audreyfeldroy/cookiecutter-pypackage',
      parentDir: '/tmp/p',
      name: 'ignored',
    });
    expect(cmd).toEqual({
      command: ['cookiecutter', 'gh:audreyfeldroy/cookiecutter-pypackage'],
      cwd: '/tmp/p',
      detect: 'diff',
      dest: null,
    });
  });

  it('builds copier copy into dest, detect=dest', () => {
    const cmd = buildSourceCommand('copier', {
      url: 'gh:org/template',
      parentDir: '/tmp/p',
      name: 'svc',
    });
    expect(cmd).toEqual({
      command: ['copier', 'copy', 'gh:org/template', '/tmp/p/svc'],
      cwd: '/tmp/p',
      detect: 'dest',
      dest: '/tmp/p/svc',
    });
  });
});
