import { describe, expect, it } from 'vitest';
import { isFileTab, prTab, tabTarget } from '../tabTarget';

describe('tabTarget', () => {
  it('reads back the PR a prTab names', () => {
    expect(prTab('github', 42)).toBe('dash:pr/github/42');
    expect(tabTarget(prTab('github', 42))).toEqual({ kind: 'pr', provider: 'github', number: 42 });
    expect(tabTarget(prTab('ado', 7))).toEqual({ kind: 'pr', provider: 'ado', number: 7 });
  });

  it('takes any other tab for a file path', () => {
    expect(tabTarget('src/a.ts')).toEqual({ kind: 'file', path: 'src/a.ts' });
    expect(tabTarget('dash:pr/gitlab/3')).toEqual({ kind: 'file', path: 'dash:pr/gitlab/3' });
    expect(tabTarget('dash:pr/github/x')).toEqual({ kind: 'file', path: 'dash:pr/github/x' });
  });

  it('tells file tabs from PR tabs', () => {
    expect(isFileTab('README.md')).toBe(true);
    expect(isFileTab(prTab('github', 1))).toBe(false);
  });
});
