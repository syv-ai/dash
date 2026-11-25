import { Check, Minus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

/**
 * A 14px round tick box, the app's one checkbox look: filled with a centred
 * tick when checked, a dash when partly (a folder whose files are only some of
 * them checked). Its click doesn't reach the row around it; inside a `<label>`
 * the label's text toggles it too.
 */
export function Checkbox({
  checked,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  checked: boolean | 'mixed';
  onChange: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        boxClass(checked),
        checked === false && 'enabled:hover:border-ink-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        focusRing,
      )}
    >
      <Mark checked={checked} />
    </button>
  );
}

const boxClass = (checked: boolean | 'mixed') =>
  cn(
    'inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors',
    // Quieter than a button: a faint ring, a mid-grey fill (`ink-3`).
    checked === false ? 'border-ink-3/60' : 'border-ink-3 bg-ink-3 text-ground',
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
