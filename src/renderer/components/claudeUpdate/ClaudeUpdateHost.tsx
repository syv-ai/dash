import { useEffect, useRef } from 'react';
import { CircleArrowUp } from 'lucide-react';
import { toast } from '../ui/toast';
import { useRuntime } from '../../stores/runtimeStore';
import { useUi } from '../../stores/uiStore';
import { ClaudeUpdateDialog } from './ClaudeUpdateDialog';

/**
 * The Claude Code update flow's app-level half: a toast the first time
 * sessions lag behind a newly installed version (once per version per run;
 * the sidebar icon stays after it goes), and the restart dialog.
 */
export function ClaudeUpdateHost() {
  const state = useRuntime((s) => s.claudeUpdate);
  const open = useUi((s) => s.claudeUpdateOpen);
  const setOpen = useUi((s) => s.setClaudeUpdateOpen);
  const toasted = useRef<string | null>(null);

  const version = state?.installedVersion ?? null;
  const count = state?.outdated.length ?? 0;
  const idle = state?.restart.phase === 'none';
  useEffect(() => {
    if (!version || count === 0 || !idle || toasted.current === version) return;
    toasted.current = version;
    toast.offer(`Claude Code ${version} is installed`, {
      icon: CircleArrowUp,
      key: `claude-update:${version}`,
      topic: 'updates',
      action: { label: 'Restart…', onClick: () => setOpen(true) },
    });
  }, [version, count, idle, setOpen]);

  if (!open || !state) return null;
  return <ClaudeUpdateDialog state={state} onClose={() => setOpen(false)} />;
}
