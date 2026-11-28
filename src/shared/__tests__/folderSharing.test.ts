import { describe, expect, it } from 'vitest';
import { canShareFolder, folderSharers } from '../folderSharing';

describe('canShareFolder', () => {
  it('lets only branchless tasks share a folder', () => {
    expect(canShareFolder({ branch: '' }, { branch: '' })).toBe(true);
    expect(canShareFolder({ branch: 'main' }, { branch: '' })).toBe(false);
    expect(canShareFolder({ branch: '' }, { branch: 'main' })).toBe(false);
    expect(canShareFolder({ branch: 'a' }, { branch: 'b' })).toBe(false);
  });
});

describe('folderSharers', () => {
  const t = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    path: '/plain',
    branch: '',
    useWorktree: false,
    archivedAt: null as string | null,
    ...over,
  });

  it('lists the other active in-place tasks in the folder', () => {
    const tasks = [
      t('a'),
      t('b'),
      t('gone', { archivedAt: '2026-01-01' }),
      t('wt', { useWorktree: true }),
      t('elsewhere', { path: '/other' }),
    ];
    expect(folderSharers(tasks[0]!, tasks).map((s) => s.id)).toEqual(['b']);
  });

  it('gives a worktree task none', () => {
    expect(folderSharers(t('wt', { useWorktree: true }), [t('a')])).toEqual([]);
  });
});
