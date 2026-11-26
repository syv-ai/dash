import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, CircleX, Copy, Info, Loader2, TriangleAlert, X } from 'lucide-react';
import { Toaster as Sonner, toast as sonner } from 'sonner';
import type { ToastKind } from '@shared/toast';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { toastBody, toastSurface } from './styles';
import { Tooltip } from './Tooltip';

/** Sonner's toaster, headless: every toast is a `ToastView` (or the ports
 *  wizard) on `toastSurface`. Raise toasts through `ui/toast`, never sonner. */
export function Toaster() {
  return (
    // `contents`: a wrapper for the key handler only; sonner places itself.
    <div className="contents" onKeyDown={dismissFocusedToast}>
      <Sonner
        position="bottom-right"
        offset={16}
        mobileOffset={16}
        gap={8}
        visibleToasts={3}
        containerAriaLabel="Notifications"
        toastOptions={{ unstyled: true, className: toastSurface }}
      />
    </div>
  );
}

/** Esc dismisses the focused toast (⌥T, then Tab to it); sonner's own Esc
 *  only collapses the stack. A dialog's capture-phase Esc still wins. */
function dismissFocusedToast(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'Escape') return;
  const li = (e.target as HTMLElement).closest('[data-sonner-toast]');
  const id = li?.querySelector<HTMLElement>('[data-toast-id]')?.dataset.toastId;
  if (id) sonner.dismiss(id);
}

/** Whether a line-clamped child cuts its text, so the whole of it can go in a tooltip. */
function useClamped<T extends HTMLElement>(text: string) {
  const ref = useRef<T>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setClamped([...el.children].some((c) => c.scrollHeight > c.clientHeight + 1));
  }, [text]);
  return [ref, clamped] as const;
}

export type ToastViewKind = ToastKind | 'copied' | 'offer' | 'progress';

const ICONS: Record<Exclude<ToastViewKind, 'offer'>, LucideIcon> = {
  info: Info,
  success: Check,
  warning: TriangleAlert,
  error: CircleX,
  copied: Copy,
  progress: Loader2,
};

interface ToastViewProps {
  id: string;
  kind: ToastViewKind;
  title: string;
  /** A sentence: `type-body`. */
  description?: string;
  /** A meta line (a task name, a path): `type-caption`. */
  meta?: string;
  action?: { label: string; onClick: () => void };
  /** An offer's own icon; other kinds take theirs from the kind. */
  icon?: LucideIcon;
}

/**
 * One toast's row: icon, title over a description or meta line, at most one
 * action, and ✕. The ✕ shows on hover or focus for a transient toast, always
 * for an offer or an error (the ones worth a deliberate dismissal). Only the
 * failure icon wears colour; an error is announced at once (`role="alert"`),
 * everything else politely through sonner's live region.
 */
export function ToastView({ id, kind, title, description, meta, action, icon }: ToastViewProps) {
  const Icon = kind === 'offer' ? (icon ?? Info) : ICONS[kind];
  const alwaysDismiss = kind === 'offer' || kind === 'error';
  const [textRef, clamped] = useClamped<HTMLDivElement>(`${title}\n${description ?? ''}`);
  return (
    <div
      data-toast-id={id}
      role={kind === 'error' ? 'alert' : undefined}
      className={cn(toastBody, 'flex items-start gap-2.5')}
    >
      <span className="flex h-5 shrink-0 items-center">
        <Icon
          size={14}
          strokeWidth={1.8}
          aria-hidden
          className={cn(
            kind === 'error' ? 'text-state-fail' : 'text-icon',
            kind === 'progress' && 'motion-safe:animate-spin',
          )}
        />
      </span>
      {/* Text past three lines is cut; the tooltip then carries all of it. */}
      <Tooltip content={clamped ? { title, body: description } : ''} delay={400}>
        <div ref={textRef} className="min-w-0 flex-1">
          <p className="type-heading line-clamp-3">{title}</p>
          {description && <p className="type-body line-clamp-3">{description}</p>}
          {meta && <p className="type-caption truncate">{meta}</p>}
        </div>
      </Tooltip>
      {(action || kind !== 'progress') && (
        <div className="-my-0.75 flex shrink-0 items-center gap-1">
          {action && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                action.onClick();
                sonner.dismiss(id);
              }}
            >
              {action.label}
            </Button>
          )}
          {kind !== 'progress' && (
            <IconButton
              size="sm"
              title="Dismiss"
              onClick={() => sonner.dismiss(id)}
              className={cn(
                !alwaysDismiss &&
                  'opacity-0 group-hover/toast:opacity-100 group-focus-within/toast:opacity-100',
              )}
            >
              <X size={14} strokeWidth={1.8} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}
