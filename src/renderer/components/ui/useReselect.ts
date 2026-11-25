import * as React from 'react';

/**
 * A double click on the option that was already selected when the gesture
 * began (a double click that first selects an option doesn't count): spread
 * `bind(option)` on each option's element.
 */
export function useReselect<T>(value: T, onReselect: ((v: T) => void) | undefined) {
  // Whether the option pressed first in the current click sequence was the
  // selected one: a double click reselects only then.
  const selectedAtPress = React.useRef(false);
  return (option: T, disabled = false) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.detail <= 1) selectedAtPress.current = option === value;
    },
    onDoubleClick:
      disabled || !onReselect
        ? undefined
        : () => {
            if (selectedAtPress.current && option === value) onReselect(option);
          },
  });
}
