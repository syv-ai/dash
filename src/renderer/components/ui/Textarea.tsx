import * as React from 'react';
import { cn } from '../../lib/cn';
import { fieldBase } from './styles';

/** Grow with the text between `minRows` (default 1) and `maxRows` (default
 *  unbounded), scrolling past the cap, instead of a fixed, resizable box. */
export interface AutoGrow {
  minRows?: number;
  maxRows?: number;
}

const variants = {
  /** A filled field, styled as `Input`. */
  field: cn(fieldBase, 'py-1.5'),
  /** A field for code (a script, command arguments): mono. */
  code: cn(fieldBase, 'py-1.5 font-mono'),
  /** Bare text on its surface (a popover's comment draft): no fill, no ring. */
  bare: 'w-full min-w-0 bg-transparent text-base leading-relaxed text-ink outline-none placeholder:text-ink-3',
};

interface TextareaProps extends React.ComponentProps<'textarea'> {
  variant?: keyof typeof variants;
  autoGrow?: AutoGrow;
}

/** Size `el` to its content, clamped to `rows` lines plus its padding and border. */
function fitToContent(el: HTMLTextAreaElement, { minRows = 1, maxRows }: AutoGrow) {
  const style = getComputedStyle(el);
  const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  const chrome =
    parseFloat(style.paddingTop) +
    parseFloat(style.paddingBottom) +
    parseFloat(style.borderTopWidth) +
    parseFloat(style.borderBottomWidth);
  const min = minRows * line + chrome;
  const max = maxRows ? maxRows * line + chrome : Infinity;
  // At zero height, scrollHeight is the text plus padding (not the rows attribute's
  // box); add the border for the border-box height.
  el.style.height = '0px';
  const content =
    el.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  el.style.height = `${Math.min(Math.max(content, min), max)}px`;
  el.style.overflowY = content > max ? 'auto' : 'hidden';
}

/** Multi-line text field. With `autoGrow`, it fits its text. */
export function Textarea({
  className,
  variant = 'field',
  autoGrow,
  ref,
  onInput,
  ...props
}: TextareaProps) {
  const own = React.useRef<HTMLTextAreaElement | null>(null);
  const setRef = React.useCallback(
    (el: HTMLTextAreaElement | null) => {
      own.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const minRows = autoGrow?.minRows;
  const maxRows = autoGrow?.maxRows;
  const grows = autoGrow !== undefined;
  // A controlled value changes without an input event; an uncontrolled one refits on input.
  React.useLayoutEffect(() => {
    if (grows && own.current) fitToContent(own.current, { minRows, maxRows });
  }, [grows, minRows, maxRows, props.value]);

  return (
    <textarea
      ref={setRef}
      className={cn(variants[variant], grows ? 'resize-none' : 'min-h-16 resize-y', className)}
      onInput={(e) => {
        if (grows) fitToContent(e.currentTarget, { minRows, maxRows });
        onInput?.(e);
      }}
      {...props}
    />
  );
}
