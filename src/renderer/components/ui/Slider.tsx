import * as SliderPrimitive from '@radix-ui/react-slider';

/**
 * Canonical single-value slider (shadcn's Slider on Radix). Pair it with the
 * current value shown beside it; the slider itself carries no label text.
 */
export function Slider({
  value,
  onValueChange,
  onValueCommit,
  min,
  max,
  step = 1,
  disabled,
  className = '',
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
      className={`relative flex w-full touch-none select-none items-center data-disabled:opacity-50 ${className}`}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-border">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow-sm shadow-shade/30 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--surface-2))]"
      />
    </SliderPrimitive.Root>
  );
}
