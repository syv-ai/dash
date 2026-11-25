import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Tab, type TabProps } from '../Tab';

// The element Tab renders, without a DOM: its handlers are called directly.
type Handlers = Record<'onClick' | 'onKeyDown' | 'onAuxClick', (e: unknown) => void>;
function render(props: TabProps): Handlers {
  const forward = Tab as unknown as {
    render: (p: TabProps, ref: null) => ReactElement<Handlers>;
  };
  return forward.render(props, null).props;
}

describe('Tab', () => {
  it('selects on click, also when a wrapping trigger passes its own onClick', () => {
    const onSelect = vi.fn();
    const triggerClick = vi.fn();
    render({ onSelect, onClick: triggerClick }).onClick({});
    expect(triggerClick).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('selects on Enter beside a passed onKeyDown', () => {
    const onSelect = vi.fn();
    const onKeyDown = vi.fn();
    render({ onSelect, onKeyDown }).onKeyDown({ key: 'Enter', preventDefault() {} });
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('closes on a middle click beside a passed onAuxClick', () => {
    const onClose = vi.fn();
    const onAuxClick = vi.fn();
    render({ onSelect: () => {}, onClose, onAuxClick }).onAuxClick({
      button: 1,
      preventDefault() {},
    });
    expect(onAuxClick).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
