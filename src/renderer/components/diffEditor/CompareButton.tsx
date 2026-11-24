import { useEffect, useState } from 'react';
import { GitCompare, GitPullRequestArrow } from 'lucide-react';
import type { EditorView } from './types';
import { prKey, usePrReviews } from '../../stores/prReviewStore';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { Segmented } from '../ui/Segmented';
import { Button } from '../ui/Button';
import { BranchPicker } from './BranchPicker';
import { PrPicker } from './PrPicker';

interface Props {
  cwd: string;
  view: EditorView;
  /** The project the checkout belongs to; null hides the Pull requests tab. */
  projectId: string | null;
  /** Resolved repo default (origin/HEAD, else main/master), listed first in the branch picker. */
  defaultBase: string | null;
  /** Switch into branch view with the given base ref (e.g. "origin/main"). */
  onSelectBase(base: string): void;
  /** Leave branch or PR view; switch back to the working tree. */
  onExitBranchView(): void;
  /** Open PR `number`'s view; resolves false when it couldn't be loaded. */
  onSelectPr(number: number): Promise<boolean>;
}

/**
 * Compare the whole editor view with a branch or pull request. It sits once
 * in the tab row, not per file: the comparison is editor-wide. While one is
 * showing, the button names it.
 */
export function CompareButton({
  cwd,
  view,
  projectId,
  defaultBase,
  onSelectBase,
  onExitBranchView,
  onSelectPr,
}: Props) {
  const isBranch = view.kind === 'branch';
  const isPr = view.kind === 'pr';
  const prTitle = usePrReviews((s) =>
    view.kind === 'pr' ? (s.byPr[prKey(view.provider, view.number)]?.title ?? null) : null,
  );
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'branches' | 'prs'>('branches');

  // A view switch from anywhere (a pick here, a History row) closes the
  // picker, so it doesn't linger over the new view.
  useEffect(() => {
    setOpen(false);
  }, [view]);

  function toggle() {
    // Open on the tab of what's showing: a PR view on its PRs, else branches.
    if (!open) setTab(isPr && projectId ? 'prs' : 'branches');
    setOpen((v) => !v);
  }

  const tooltip = isBranch
    ? `Comparing with ${view.base}`
    : isPr
      ? `PR #${view.number}${prTitle ? `: ${prTitle}` : ''}`
      : 'Compare with a branch or pull request';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="inline-flex min-w-0 shrink items-center">
          <Tooltip content={tooltip}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={tooltip}
              onClick={toggle}
              className="min-w-0"
            >
              {isPr ? (
                <GitPullRequestArrow size={14} strokeWidth={1.8} className="shrink-0" />
              ) : (
                <GitCompare size={14} strokeWidth={1.8} className="shrink-0" />
              )}
              <span className="max-w-40 truncate whitespace-nowrap @max-[28rem]/strip:hidden">
                {isBranch ? `vs ${view.base}` : isPr ? `PR #${view.number}` : 'Compare'}
              </span>
            </Button>
          </Tooltip>
        </div>
      </PopoverAnchor>
      <PopoverContent side="bottom" align="end" sideOffset={6}>
        <div className="flex h-95 w-85 flex-col">
          {projectId && (
            <div className="px-2.5 pt-2.5 pb-1">
              <Segmented
                size="sm"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'branches', label: 'Branches' },
                  { value: 'prs', label: 'Pull requests' },
                ]}
              />
            </div>
          )}
          {tab === 'prs' && projectId ? (
            <PrPicker
              projectId={projectId}
              cwd={cwd}
              selected={isPr ? view.number : null}
              onSelect={onSelectPr}
              onExit={isPr ? onExitBranchView : undefined}
            />
          ) : (
            <BranchPicker
              cwd={cwd}
              selectedRef={isBranch ? view.base : null}
              onSelect={onSelectBase}
              onExit={isBranch ? onExitBranchView : undefined}
              defaultRef={defaultBase}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
