import { describe, it, expect } from 'vitest';
import { cn } from '../cn';

describe('cn', () => {
  it('lets a later text size win, and keeps a text colour beside it', () => {
    expect(cn('text-xs text-ink-2', 'text-base')).toBe('text-ink-2 text-base');
  });

  it('treats a fade utility as a text colour', () => {
    expect(cn('text-muted-fade-50', 'text-ink')).toBe('text-ink');
  });

  it('lets a later radius tier win', () => {
    expect(cn('rounded-md', 'rounded-xl')).toBe('rounded-xl');
  });

  it('treats fade-N as opacity', () => {
    expect(cn('opacity-40', 'fade-70')).toBe('fade-70');
  });

  it('drops falsy inputs', () => {
    expect(cn('px-2', false, undefined, 'py-1')).toBe('px-2 py-1');
  });
});
