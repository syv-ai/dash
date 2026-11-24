import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

/**
 * Single-value slider (shadcn's Slider on Radix): a 4px hover-tint track, the
 * filled range in ink-2, an ink thumb. Pair it with the current value shown
 * beside it; the slider itself carries no label text.
 */
export function Slider({
  value,
  onValueChange,
  onValueCommit,
  min,
  max,
  step = 1,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  value: number;
  onValueChange: (value: number) => void;
  /** Fires once when the user lets go (pointer up or key press), unlike
   *  onValueChange, which fires on every step of a drag. */
  onValueCommit?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <SliderPrimitive.Root
      value={[value]}
      onValueChange={([v]) => {
        if (v !== undefined) onValueChange(v);
      }}
      onValueCommit={([v]) => {
        if (v !== undefined) onValueCommit?.(v);
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn(
        'relative flex h-4 w-full touch-none select-none items-center data-disabled:opacity-40',
        className,
      )}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-hover">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-ink-2" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        className={cn(
          'block size-3.5 cursor-pointer rounded-full bg-ink transition-transform hover:scale-110',
          focusRing,
        )}
      />
    </SliderPrimitive.Root>
  );
}
