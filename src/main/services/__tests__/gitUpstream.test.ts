import { describe, it, expect } from 'vitest';
import { parseUpstream } from '../GitService';

describe('parseUpstream', () => {
  it('reads the remote and the branch on it', () => {
    expect(parseUpstream('origin\trefs/heads/feat/x\n')).toEqual({
      remote: 'origin',
      branch: 'feat/x',
    });
  });

  it('is null without an upstream or for a local one', () => {
    expect(parseUpstream('\t\n')).toBeNull();
    expect(parseUpstream('')).toBeNull();
    expect(parseUpstream('.\trefs/heads/main\n')).toBeNull();
  });
});
