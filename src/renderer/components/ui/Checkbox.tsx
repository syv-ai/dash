import { Check, Minus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

/**
 * A 14px tick box: filled when checked, a dash when partly (a folder whose
 * files are only some of them checked). Its click doesn't reach the row
 * around it.
 */
export function Checkbox({
  checked,
  onChange,
  'aria-label': ariaLabel,
}: {
  checked: boolean | 'mixed';
  onChange: () => void;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn(boxClass(checked), checked === false && 'hover:border-ink-2', focusRing)}
    >
      <Mark checked={checked} />
    </button>
  );
}

const boxClass = (checked: boolean | 'mixed') =>
  cn(
    'inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors',
    checked === false ? 'border-ink-3' : 'border-btn bg-btn text-btn-ink',
  );

function Mark({ checked }: { checked: boolean | 'mixed' }) {
  if (checked === true) return <Check size={10} strokeWidth={3} />;
  if (checked === 'mixed') return <Minus size={10} strokeWidth={3} />;
  return null;
}

/** The same box, read-only: a ticked item in rendered text (a Markdown task
 *  list), not a control. */
export function CheckboxMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      aria-readonly
      className={cn(boxClass(checked), className)}
    >
      <Mark checked={checked} />
    </span>
  );
}
