import { describe, it, expect } from 'vitest';
import { protectedArchiveConfirm } from '../protectedTask';

describe('protectedArchiveConfirm', () => {
  it('names the task and its protection', () => {
    const c = protectedArchiveConfirm('spec-lead');
    expect(c.title).toBe('Archive spec-lead?');
    expect(c.message).toMatch(/^spec-lead is protected: agents can't archive or delete it\./);
    expect(c.confirmLabel).toBe('Archive');
  });
});
