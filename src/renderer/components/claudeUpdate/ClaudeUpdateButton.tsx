import { CircleArrowUp, Hourglass, RefreshCw } from 'lucide-react';
import { useRuntime } from '../../stores/runtimeStore';
import { useUi } from '../../stores/uiStore';
import { IconButton } from '../ui/IconButton';
import { updateIndicator, type UpdateIndicator } from './claudeUpdateCopy';

const ICONS: Record<UpdateIndicator['kind'], React.ReactNode> = {
  available: <CircleArrowUp size={14} strokeWidth={1.8} />,
  waiting: <Hourglass size={14} strokeWidth={1.8} />,
  restarting: <RefreshCw size={14} strokeWidth={1.8} className="motion-safe:animate-spin" />,
};

/**
 * The sidebar's Claude Code update icon, beside Settings: there while any live
 * session runs an older Claude Code than the installed one, or while a
 * restart is pending or under way; it opens the restart dialog.
 */
export function ClaudeUpdateButton() {
  const indicator = updateIndicator(useRuntime((s) => s.claudeUpdate));
  const setOpen = useUi((s) => s.setClaudeUpdateOpen);
  if (!indicator) return null;
  return (
    <IconButton
      title={indicator.title}
      description={indicator.description}
      onClick={() => setOpen(true)}
    >
      {ICONS[indicator.kind]}
    </IconButton>
  );
}
