import type { KeyboardEvent, MouseEvent } from 'react';

/** A button's click inside a clickable row: its own, not the row's too. */
export const rowAction =
  (run: () => void) =>
  (e: MouseEvent): void => {
    e.stopPropagation();
    run();
  };

/** Enter or Space on a row rendered as a `div` (its buttons can't nest in a
 *  `button`): the row's click. Keys bubbling up from its buttons and inputs
 *  stay theirs. */
export const rowKeys =
  (run: () => void) =>
  (e: KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    run();
  };
