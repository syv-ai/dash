import type { MouseEvent, ReactNode } from 'react';
import { Anchor, Bot, MessageSquare, Pencil, Undo2, X } from 'lucide-react';
import type { DiffCommentKind } from '../../../../shared/types';
import type { Shade } from './types';
import { BUBBLE_FADE, BubbleShell } from './BubbleShell';
import { Markdown } from '../../ui/Markdown';
import { IconButton } from '../../ui/IconButton';
import { BubbleHeader } from './BubbleHeader';

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
  /** A PR line draft written on an older head of the PR: that commit. Its lines
   *  may sit on other code now, and posting the review holds it back. Null otherwise. */
  movedFrom?: string | null;
  /** Anchor a moved draft to the PR's head, where it sits now. */
  onAnchor?(): void;
}

/** One persisted speech-bubble card: its header (where it sits, what kind
 *  it is, and on hover its actions: edit, promote/demote, reopen, delete,
 *  right-aligned on that line), then its text. Editing keeps the header and
 *  turns the text into the composer (`DraftBubble`). */
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
  movedFrom,
  onAnchor,
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
    // The whole card, its padding too, shows the actions on hover.
    <div
      className="group/bubble"
      style={{
        opacity,
        transition: BUBBLE_FADE,
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
        <div className="flex flex-col gap-2">
          <BubbleHeader
            kind={kind}
            meta={meta}
            scopeLabel={scopeLabel}
            byAgent={byAgent}
            sent={sent}
            movedFrom={movedFrom}
            actions={
              <div className="flex items-center opacity-0 transition-opacity group-hover/bubble:opacity-100 focus-within:opacity-100">
                {action('Edit', <Pencil size={14} strokeWidth={1.8} />, onDoubleClick)}
                {onPromote &&
                  action(
                    'Make it a comment for the author',
                    <MessageSquare size={14} strokeWidth={1.8} />,
                    onPromote,
                  )}
                {onDemote &&
                  action('Make it a note to agent', <Bot size={14} strokeWidth={1.8} />, onDemote)}
                {movedFrom &&
                  onAnchor &&
                  action(
                    "Keep it here: it's about these lines in the PR as it is now",
                    <Anchor size={14} strokeWidth={1.8} />,
                    onAnchor,
                  )}
                {sent &&
                  action(
                    'Reopen — include in the next send',
                    <Undo2 size={14} strokeWidth={1.8} />,
                    onReopen,
                  )}
                {action('Delete', <X size={14} strokeWidth={1.8} />, onDelete, true)}
              </div>
            }
          />
          <Markdown text={text} />
        </div>
      </BubbleShell>
    </div>
  );
}
