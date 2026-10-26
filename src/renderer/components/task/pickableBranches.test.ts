import { describe, it, expect } from 'vitest';
import type { BranchInfo } from '../../../shared/types';
import { pickableBranches } from './pickableBranches';

const b = (ref: string): BranchInfo => ({ name: ref, ref, shortHash: '', relativeDate: '' });
const list = [b('origin/main'), b('origin/HEAD')];

describe('pickableBranches', () => {
  it('offers origin/HEAD as a base for a new branch', () => {
    expect(pickableBranches(list, true).map((x) => x.ref)).toEqual(['origin/main', 'origin/HEAD']);
  });
  it('hides origin/HEAD when checking out an existing branch', () => {
    expect(pickableBranches(list, false).map((x) => x.ref)).toEqual(['origin/main']);
  });
});
