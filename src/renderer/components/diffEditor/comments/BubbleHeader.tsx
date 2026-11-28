import type { ReactNode } from 'react';
import { Bot, MessageSquare } from 'lucide-react';
import type { DiffCommentKind } from '../../../../shared/types';
import { Badge } from '../../ui/Badge';
import { DraftBadge } from '../prReview/PrComment';

/** The kind's icon and name, the same in every list (D10). */
function KindLabel({ kind }: { kind: DiffCommentKind }) {
  return (
    <span className="type-caption inline-flex items-center gap-1">
      {kind === 'note' ? (
        <Bot size={14} strokeWidth={1.8} className="text-icon" />
      ) : (
        <MessageSquare size={14} strokeWidth={1.8} className="text-icon" />
      )}
      {kind === 'note' ? 'Note to agent' : 'Comment'}
    </span>
  );
}

/**
 * A note or comment card's top line, read or being edited alike: its kind,
 * lines and tags on the left, `actions` right-aligned on the same line. The
 * line keeps an icon button's height with or without them, so the card
 * doesn't move as it turns editable.
 */
export function BubbleHeader({
  kind,
  meta,
  scopeLabel,
  byAgent,
  sent,
  movedFrom,
  actions,
}: {
  kind: DiffCommentKind;
  /** Where it sits: 'L15' or 'L15-18', and its place in a stack. */
  meta: string;
  /** The diff it anchors to, when the view isn't the plain working tree. */
  scopeLabel?: string;
  /** Drafted by a task's agent, not yet edited by the person. */
  byAgent?: boolean;
  /** Already sent to the agent. */
  sent?: boolean;
  /** A PR line draft written on an older head of the PR: that commit. */
  movedFrom?: string | null;
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-6 items-center gap-1.5">
      <KindLabel kind={kind} />
      <span className="type-caption tabular-nums">{meta}</span>
      {/* A comment for the author is only here until the review posts. */}
      {kind === 'comment' && <DraftBadge />}
      {scopeLabel && <Badge size="sm">{scopeLabel}</Badge>}
      {byAgent && <Badge size="sm">Agent</Badge>}
      {sent && <Badge size="sm">Sent</Badge>}
      {movedFrom && (
        <Badge
          size="sm"
          tone="warn"
          title={`Written on ${movedFrom.slice(0, 7)}; the PR has changed since, so these lines may be other code now. Posting the review holds it back until you keep it here, edit its lines, or delete it.`}
        >
          PR moved
        </Badge>
      )}
      {actions && <div className="-mr-1.5 ml-auto flex items-center">{actions}</div>}
    </div>
  );
}
