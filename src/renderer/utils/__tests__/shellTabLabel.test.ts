import { describe, it, expect } from 'vitest';
import { nextShellLabel } from '../shellTabLabel';

describe('nextShellLabel', () => {
  it('starts at 1 with no tabs', () => {
    expect(nextShellLabel([])).toBe('1');
  });

  it('increments past the highest existing number', () => {
    expect(nextShellLabel(['1', '2'])).toBe('3');
  });

  it('does not reuse a number after a lower tab was closed', () => {
    // close "1", then add: must not produce a second "2"
    expect(nextShellLabel(['2'])).toBe('3');
  });

  it('ignores non-numeric labels from service/tui tabs', () => {
    expect(nextShellLabel(['web', 'Ports setup', '1'])).toBe('2');
  });
});
