import type { ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { getBindingKeys, type KeyBinding } from '../../keybindings';
import { useGit } from '../../stores/gitStore';
import { useSettings } from '../../stores/settingsStore';
import { CommitPopover } from './CommitPopover';
import type { CommitRun } from './useCommitRun';

/**
 * The working tree's commit actions, as the Changes list's footer: Stage all
 * and Unstage all (each off while it has nothing to act on), then Commit.
 * Where the list is narrow, the stage buttons keep their icons alone (their
 * tooltips name them).
 */
export function CommitBar({ run }: { run: CommitRun }) {
  const files = useGit((s) => s.gitStatus?.files);
  const stageAll = useGit((s) => s.stageAll);
  const unstageAll = useGit((s) => s.unstageAll);
  const keybindings = useSettings((s) => s.keybindings);
  const staged = files?.filter((f) => f.staged).length ?? 0;
  const unstaged = (files?.length ?? 0) - staged;
  return (
    <div className="@container/commitbar flex h-10 shrink-0 items-center gap-1 border-t border-line px-2">
      <BulkButton
        label="Stage all"
        binding={keybindings.stageAll}
        icon={<Plus size={14} strokeWidth={1.8} />}
        disabled={unstaged === 0}
        onClick={() => void stageAll()}
      />
      <BulkButton
        label="Unstage all"
        binding={keybindings.unstageAll}
        icon={<Minus size={14} strokeWidth={1.8} />}
        disabled={staged === 0}
        onClick={() => void unstageAll()}
      />
      <div className="ml-auto">
        <CommitPopover run={run} />
      </div>
    </div>
  );
}

function BulkButton({
  label,
  binding,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  binding: KeyBinding | undefined;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={{ title: label, shortcut: binding && getBindingKeys(binding) }}>
      <Button variant="ghost" size="sm" aria-label={label} disabled={disabled} onClick={onClick}>
        {icon}
        <span className="@max-2xs/commitbar:hidden">{label}</span>
      </Button>
    </Tooltip>
  );
}
