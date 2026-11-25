import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { isRichTooltip } from '../Tooltip';

describe('isRichTooltip', () => {
  it('takes a card for a titled object', () => {
    expect(isRichTooltip({ title: 'Close editor', shortcut: ['⌘', 'W'] })).toBe(true);
    expect(isRichTooltip({ title: '5-hour limit', rows: [{ label: 'Used', value: '42%' }] })).toBe(
      true,
    );
  });

  it('leaves plain text and nodes plain', () => {
    expect(isRichTooltip('Copy path')).toBe(false);
    expect(isRichTooltip(7)).toBe(false);
    expect(isRichTooltip(createElement('span', null, 'Copy'))).toBe(false);
    expect(isRichTooltip(['a', 'b'])).toBe(false);
    expect(isRichTooltip(null)).toBe(false);
    expect(isRichTooltip(undefined)).toBe(false);
  });
});
