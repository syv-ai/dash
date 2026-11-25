import { describe, expect, it } from 'vitest';
import { defaultFilesScope, parseFilesScope } from '../filesScope';

describe('defaultFilesScope', () => {
  it('lists the changes when there are any, else all files', () => {
    expect(defaultFilesScope(3)).toBe('changed');
    expect(defaultFilesScope(0)).toBe('all');
  });

  it('waits for the status to load', () => {
    expect(defaultFilesScope(null)).toBeNull();
  });
});

describe('parseFilesScope', () => {
  it('reads a stored pick', () => {
    expect(parseFilesScope('changed')).toBe('changed');
    expect(parseFilesScope('all')).toBe('all');
  });

  it('reads nothing, or a value it does not know, as no pick', () => {
    expect(parseFilesScope(null)).toBeNull();
    expect(parseFilesScope('changes')).toBeNull();
  });
});
