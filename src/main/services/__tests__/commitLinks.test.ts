import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commitLinks } from '../commitLinks';

const git = vi.hoisted(() => ({
  origin: 'git@github.com:o/r.git' as string | null,
  pushed: true,
}));
const authorUrl = vi.hoisted(() => vi.fn(async () => 'https://github.com/someone'));

vi.mock('../GitService', () => ({
  GitService: {
    getOriginUrl: vi.fn(async () => git.origin),
    isOnRemote: vi.fn(async () => git.pushed),
  },
}));
vi.mock('../GithubService', () => ({ GithubService: { commitAuthorUrl: authorUrl } }));

let n = 0;
const sha = () => `sha${n++}`;

beforeEach(() => {
  git.origin = 'git@github.com:o/r.git';
  git.pushed = true;
  authorUrl.mockClear();
});

describe('commitLinks', () => {
  it('links a pushed GitHub commit and its author', async () => {
    const h = sha();
    expect(await commitLinks('/w', h)).toEqual({
      commitUrl: `https://github.com/o/r/commit/${h}`,
      authorUrl: 'https://github.com/someone',
    });
  });

  it('links nothing for an unpushed commit, and asks again later', async () => {
    const h = sha();
    git.pushed = false;
    expect(await commitLinks('/w', h)).toEqual({ commitUrl: null, authorUrl: null });
    git.pushed = true;
    expect((await commitLinks('/w', h)).commitUrl).toContain(h);
  });

  it('asks GitHub once per pushed commit', async () => {
    const h = sha();
    await commitLinks('/w', h);
    await commitLinks('/w', h);
    expect(authorUrl).toHaveBeenCalledTimes(1);
  });

  it('links a GitLab commit without guessing its author', async () => {
    git.origin = 'git@gitlab.com:g/p.git';
    const h = sha();
    expect(await commitLinks('/w', h)).toEqual({
      commitUrl: `https://gitlab.com/g/p/-/commit/${h}`,
      authorUrl: null,
    });
    expect(authorUrl).not.toHaveBeenCalled();
  });

  it('keeps the commit link when GitHub cannot be asked', async () => {
    authorUrl.mockRejectedValueOnce(new Error('gh: not logged in'));
    const h = sha();
    expect(await commitLinks('/w', h)).toMatchObject({ authorUrl: null });
  });
});
