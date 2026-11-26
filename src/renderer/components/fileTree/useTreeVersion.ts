import { useEffect, useState } from 'react';

/**
 * A count that moves each time a file or folder under `cwd` comes, goes or is
 * renamed (main watches the folder while `enabled`): a listing keyed on it
 * reloads. Git's own signals miss untracked and ignored files, which the
 * all-files tree shows too.
 */
export function useTreeVersion(cwd: string, enabled: boolean): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled || !cwd) return;
    void window.electronAPI.editorWatchTree({ cwd });
    const off = window.electronAPI.onEditorTreeChanged((e) => {
      if (e.cwd === cwd) setVersion((v) => v + 1);
    });
    return () => {
      off();
      void window.electronAPI.editorUnwatchTree({ cwd });
    };
  }, [cwd, enabled]);
  return version;
}
