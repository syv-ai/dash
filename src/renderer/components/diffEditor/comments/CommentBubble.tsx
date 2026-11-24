import type { MouseEvent, ReactNode } from 'react';
import { Bot, MessageSquare, Pencil, Undo2, X } from 'lucide-react';
import type { DiffCommentKind } from '../../../../shared/types';
import type { Shade } from './types';
import { BubbleShell } from './BubbleShell';
import { Markdown } from '../../ui/Markdown';
import { Badge } from '../../ui/Badge';
import { IconButton } from '../../ui/IconButton';

interface Props {
  shade: Shade;
  /** Short label like 'L15-18' rendered above the body text. */
  meta: string;
  text: string;
  /** Already pushed to the agent — the card dims to read as "done". */
  sent: boolean;
  /** Drafted by a task's agent (a PR review draft); the person hasn't edited it yet. */
  byAgent?: boolean;
  /** Origin tag (e.g. 'Working tree', 'Commit abc1234') shown when the open
   *  view isn't the plain working tree, so it's clear which diff this anchors
   *  to. Undefined → no tag. */
  scopeLabel?: string;
  /** Only the bottom-most bubble in a stack shows a tail. */
  hasTail: boolean;
  /** Bubble fill intensifies when the row OR this bubble is hovered. */
  isHighlighted: boolean;
  tailLeftPx: number;
  onMouseEnter(): void;
  onMouseLeave(): void;
  /** Dbl-click → re-open the WIP input prefilled with this comment's text. */
  onDoubleClick(): void;
  /** Click the in-bubble × → delete this comment. ESC is taken by the
   *  surrounding Modal, so a button is the keyboard-free path. */
  onDelete(): void;
  /** Click the in-bubble reopen control on a SENT comment → mark it unsent so
   *  it rejoins the next prompt. Only rendered when `sent`. */
  onReopen(): void;
  /** True when this comment is currently being edited — the persisted
   *  card fades to opacity 0 while the DraftBubble crossfades in beside
   *  it, so the read-only → editable transition reads as a single morph
   *  instead of an unmount + remount pop. */
  isFadingOut: boolean;
  /** A note to the agent or a comment for the PR's author. */
  kind: DiffCommentKind;
  /** Make this note a PR review comment (a PR's note only). */
  onPromote?(): void;
  /** Make this comment a note to the agent (a PR's line comment only). */
  onDemote?(): void;
}

/** The kind's icon and name, the same in every list (D10). */
function KindLabel({ kind }: { kind: DiffCommentKind }) {
  return (
    <span className="type-caption inline-flex items-center gap-1">
      {kind === 'note' ? (
        <Bot size={14} strokeWidth={1.8} />
      ) : (
        <MessageSquare size={14} strokeWidth={1.8} />
      )}
      {kind === 'note' ? 'Note to agent' : 'Comment'}
    </span>
  );
}

/** One persisted speech-bubble card: where it sits, what kind it is, its
 *  text, and hover actions (edit, promote/demote, reopen, delete). */
export function CommentBubble({
  shade,
  meta,
  text,
  sent,
  byAgent,
  scopeLabel,
  hasTail,
  isHighlighted,
  tailLeftPx,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
  onDelete,
  onReopen,
  isFadingOut,
  kind,
  onPromote,
  onDemote,
}: Props) {
  // A sent comment fades back so it reads as "already pushed" without
  // disappearing (it stays editable/removable). A bubble mid-edit takes
  // precedence and fades fully out as the draft crossfades in.
  const opacity = isFadingOut ? 0 : sent ? 0.4 : 1;
  // The bubble's double-click edits: an action's clicks stay with it.
  const act = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  const action = (title: string, icon: ReactNode, fn: () => void, destructive = false) => (
    <IconButton
      size="sm"
      title={title}
      variant={destructive ? 'destructive' : 'default'}
      onClick={act(fn)}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {icon}
    </IconButton>
  );
  return (
    <div
      style={{
        opacity,
        transition: 'opacity 240ms ease-out',
        pointerEvents: isFadingOut ? 'none' : 'auto',
      }}
    >
      <BubbleShell
        shade={shade}
        hasTail={hasTail}
        isHighlighted={isHighlighted}
        tailLeftPx={tailLeftPx}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onDoubleClick={onDoubleClick}
        rule={kind === 'note' ? 'dashed' : 'solid'}
      >
        <div className="group/bubble">
          <div className="absolute top-1 right-1 z-10 flex items-center opacity-0 transition-opacity group-hover/bubble:opacity-100 focus-within:opacity-100">
            {action('Edit', <Pencil size={14} strokeWidth={1.8} />, onDoubleClick)}
            {onPromote &&
              action(
                'Make it a comment for the author',
                <MessageSquare size={14} strokeWidth={1.8} />,
                onPromote,
              )}
            {onDemote &&
              action('Make it a note to agent', <Bot size={14} strokeWidth={1.8} />, onDemote)}
            {sent &&
              action(
                'Reopen — include in the next send',
                <Undo2 size={14} strokeWidth={1.8} />,
                onReopen,
              )}
            {action('Delete', <X size={14} strokeWidth={1.8} />, onDelete, true)}
          </div>
          <div className="mb-0.5 flex items-center gap-1.5">
            <KindLabel kind={kind} />
            <span className="type-caption tabular-nums">{meta}</span>
            {scopeLabel && <Badge size="sm">{scopeLabel}</Badge>}
            {byAgent && <Badge size="sm">Agent</Badge>}
            {sent && <Badge size="sm">Sent</Badge>}
          </div>
          <Markdown text={text} />
        </div>
      </BubbleShell>
    </div>
  );
}
