import { useEffect } from 'react';
import { toast } from 'sonner';
import { useSettings } from '../../stores/settingsStore';
import { normalizeVersion, releaseUrl, shouldShowReleaseNotes } from '../../utils/releaseNotes';

/**
 * On the first launch after an update, surface a once-per-version toast linking
 * to that version's GitHub release notes. "First launch after an update" is
 * detected by comparing the running version to the last version the user was
 * shown (persisted in settings) — so it also covers manual .dmg updates, not
 * just the in-app auto-updater.
 *
 * A fresh install (no stored version) catches up silently so it stays quiet,
 * and `lastSeen` is advanced even when the toast is muted so a muted user isn't
 * re-evaluated as "new" on every launch.
 */
export function useReleaseNotesToast(): void {
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.getAppVersion().then((current) => {
      if (cancelled || !current) return;
      const {
        lastSeenReleaseNotesVersion,
        updateNotificationsEnabled,
        setLastSeenReleaseNotesVersion,
      } = useSettings.getState();

      // Fresh install: record where we are without nagging about it.
      if (lastSeenReleaseNotesVersion === undefined) {
        setLastSeenReleaseNotesVersion(current);
        return;
      }
      if (!shouldShowReleaseNotes(current, lastSeenReleaseNotesVersion)) return;

      setLastSeenReleaseNotesVersion(current);
      if (!updateNotificationsEnabled) return;

      toast(`Dash updated to v${normalizeVersion(current)}`, {
        duration: Infinity,
        action: {
          label: 'Release notes',
          onClick: () => {
            void window.electronAPI.openExternal(releaseUrl(current));
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
