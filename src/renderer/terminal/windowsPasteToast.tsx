import { useState } from 'react';
import { Check, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { useSettings } from '../stores/settingsStore';

// Fixed id so repeated Ctrl+V presses de-dupe onto one toast instead of stacking.
const TOAST_ID = 'windows-paste-tip';

// Closed without ticking "Don't show again": stay quiet for the rest of this
// session, but nudge once more next launch. Ticking the box persists instead.
let suppressedThisSession = false;

function PasteTip({ onClose }: { onClose: (dontShowAgain: boolean) => void }) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  return (
    <div className="w-[300px] rounded-lg border border-border bg-[hsl(var(--surface-2))] shadow-lg px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">
          <ClipboardPaste size={14} className="text-primary" strokeWidth={2} />
        </span>
        <div className="text-[13px] text-foreground/90 leading-snug">
          <div className="font-medium text-foreground">Use Alt+V to paste on Windows</div>
          <div className="mt-0.5 text-muted-foreground">
            Ctrl+V and Ctrl+Shift+V silently drop text from long pastes. We recommend Alt+V — Claude
            Code has supported it natively for text and images since v2.1.157 (May 2026).
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        {/* Mirrors the ports wizard's footer: the permanent opt-out sits left and
            quiet, leaving the plain close as the obvious default action. */}
        <label className="mr-auto flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground">
          {/* appearance-none so the unchecked box sits on the card's own
              background behind a grey border, rather than native white. */}
          <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="peer absolute inset-0 cursor-pointer appearance-none rounded-[3px] border border-border bg-[hsl(var(--surface-2))] transition-colors checked:border-primary checked:bg-primary"
            />
            <Check
              size={10}
              strokeWidth={3}
              className="pointer-events-none relative text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100"
            />
          </span>
          Don’t show again
        </label>
        <button
          type="button"
          onClick={() => onClose(dontShowAgain)}
          className="rounded-md px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent/60 hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * Windows-only nudge: pasting into the Claude Code TUI with Ctrl+V / Ctrl+Shift+V
 * is unreliable here — ConPTY silently drops writes past ~2 KB, so long pastes
 * lose text with no error. Alt+V is handled natively by Claude Code (v2.1.157,
 * May 2026) for both text and images, so we point users at it.
 */
export function maybeShowWindowsPasteToast(): void {
  if (suppressedThisSession) return;
  if (useSettings.getState().hasDismissedWindowsPasteToast) return;

  toast.custom(
    (id) => (
      <PasteTip
        onClose={(dontShowAgain) => {
          if (dontShowAgain) useSettings.getState().setHasDismissedWindowsPasteToast(true);
          suppressedThisSession = true;
          toast.dismiss(id);
        }}
      />
    ),
    {
      id: TOAST_ID,
      duration: Infinity,
      dismissible: true,
      // Swipe/close without the box ticked counts as "not now", not "never".
      onDismiss: () => {
        suppressedThisSession = true;
      },
    },
  );
}
