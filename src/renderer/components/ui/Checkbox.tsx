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
      className={cn(
        'inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors',
        checked === false ? 'border-ink-3 hover:border-ink-2' : 'border-btn bg-btn text-btn-ink',
        focusRing,
      )}
    >
      {checked === true && <Check size={10} strokeWidth={3} />}
      {checked === 'mixed' && <Minus size={10} strokeWidth={3} />}
    </button>
  );
}
