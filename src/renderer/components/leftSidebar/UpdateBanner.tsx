import { useState } from 'react';
import { Download, RefreshCw, AlertTriangle, X } from 'lucide-react';
import { useRuntime } from '../../stores/runtimeStore';
import { useUi } from '../../stores/uiStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Meter } from '../ui/Meter';

/**
 * Persistent update surface at the foot of the sidebar. It stays put until the
 * user acts, which is the whole point: the old flow used transient toasts, so
 * missing one meant missing the update, and a check every four hours stacked a
 * fresh never-dismissing toast on top of the last (#173).
 *
 * Silent unless there is something to say — idle and checking render nothing.
 * The ready and failed notices can be closed for the rest of the session
 * (Settings → Updates still offers the restart); a newer version reopens them.
 */
export function UpdateBanner() {
  const status = useRuntime((s) => s.updateStatus);
  const installUpdate = useRuntime((s) => s.installUpdate);
  const dismissedVersion = useUi((s) => s.dismissedUpdateVersion);
  const setDismissedVersion = useUi((s) => s.setDismissedUpdateVersion);
  const [installing, setInstalling] = useState(false);

  if (!status || !status.initialized) return null;

  const versionKey = status.availableVersion ?? '';
  const dismissed = dismissedVersion === versionKey;
  const onClose = () => setDismissedVersion(versionKey);

  // A failed check is not worth a banner — Settings → Updates carries the
  // error. Only a failure that stranded a known update earns the interruption.
  const strandedError = status.lastError && status.state === 'available' ? status.lastError : null;

  if (status.state === 'downloading') {
    const version = status.availableVersion ? `v${status.availableVersion}` : 'Update';
    return (
      <Shell>
        <div className="flex items-center gap-2">
          <Download size={14} strokeWidth={1.8} className="shrink-0 text-icon" />
          <span className="truncate text-sm text-ink-2">Downloading {version}…</span>
          {status.percent !== null && (
            <span className="ml-auto text-sm tabular-nums text-ink-3">{status.percent}%</span>
          )}
        </div>
        <Meter
          role="progressbar"
          value={status.percent ?? 0}
          className="mt-2"
          aria-label={`Downloading ${version}`}
        />
      </Shell>
    );
  }

  if (status.state === 'ready' && !dismissed) {
    return (
      <Shell onClose={onClose}>
        <p className="pr-6 text-sm text-ink">
          {status.availableVersion ? `v${status.availableVersion}` : 'An update'} is ready.
        </p>
        <p className="mt-0.5 text-sm text-ink-3">Your sessions re-attach after restarting.</p>
        <Button
          size="sm"
          className="w-full mt-2"
          disabled={installing}
          onClick={() => {
            setInstalling(true);
            void installUpdate().finally(() => setInstalling(false));
          }}
        >
          <RefreshCw size={14} strokeWidth={1.8} />
          {installing ? 'Restarting…' : 'Restart to update'}
        </Button>
      </Shell>
    );
  }

  if (strandedError && !dismissed) {
    return (
      <Shell onClose={onClose}>
        <div className="flex items-start gap-2 pr-6">
          <AlertTriangle size={14} strokeWidth={1.8} className="mt-0.5 shrink-0 text-state-fail" />
          <div className="min-w-0">
            <p className="text-sm text-ink">
              {status.availableVersion ? `v${status.availableVersion}` : 'An update'} could not be
              downloaded.
            </p>
            <p className="mt-0.5 truncate text-sm text-ink-3" title={strandedError}>
              {strandedError}
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  return null;
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="shrink-0 px-2 pt-2">
      <div className="relative rounded-lg bg-hover px-3 py-2.5">
        {onClose && (
          <IconButton
            title="Dismiss"
            size="sm"
            onClick={onClose}
            className="absolute top-1.5 right-1.5"
          >
            <X size={14} strokeWidth={1.8} />
          </IconButton>
        )}
        {children}
      </div>
    </div>
  );
}
