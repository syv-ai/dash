import { useState } from 'react';
import { SmilePlus, ThumbsUp } from 'lucide-react';
import { REACTIONS, reactionChoices } from '../../../../shared/prReactions';
import type { PrProvider, PrReactionContent, PrReviewComment } from '../../../../shared/types';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/Popover';
import { ReactionChip } from '../../ui/ReactionChip';
import { Tooltip } from '../../ui/Tooltip';

/**
 * A posted comment's reactions: one chip per reaction someone gave, pressed
 * where the viewer did; a click gives or takes back theirs. Nothing when no
 * one reacted. Each click posts at once (D194).
 */
export function ReactionChips({
  comment,
  onReact,
}: {
  comment: PrReviewComment;
  onReact: (content: PrReactionContent, on: boolean) => void;
}) {
  if (comment.reactions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {comment.reactions.map((r) => (
        <ReactionChip
          key={r.content}
          emoji={REACTIONS[r.content].emoji}
          name={REACTIONS[r.content].name}
          count={r.count}
          pressed={r.viewerReacted}
          onToggle={() => onReact(r.content, !r.viewerReacted)}
        />
      ))}
    </div>
  );
}

/**
 * The way to react, among a comment's header actions: GitHub's eight in a
 * picker (picking one you gave takes it back); ADO's like as one button,
 * until someone likes it and its chip toggles it.
 */
export function AddReaction({
  comment,
  provider,
  onReact,
}: {
  comment: PrReviewComment;
  provider: PrProvider;
  onReact: (content: PrReactionContent, on: boolean) => void;
}) {
  const choices = reactionChoices(provider);
  const mine = (c: PrReactionContent) =>
    comment.reactions.some((r) => r.content === c && r.viewerReacted);
  if (choices.length > 1)
    return <ReactionPicker choices={choices} onPick={(c) => onReact(c, !mine(c))} />;
  const like = choices[0]!;
  if (comment.reactions.some((r) => r.content === like)) return null;
  return (
    <IconButton size="sm" title={REACTIONS[like].name} onClick={() => onReact(like, true)}>
      <ThumbsUp size={14} strokeWidth={1.8} />
    </IconButton>
  );
}

/** GitHub's eight in a row; picking one gives it (or takes yours back). */
function ReactionPicker({
  choices,
  onPick,
}: {
  choices: readonly PrReactionContent[];
  onPick: (content: PrReactionContent) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton size="sm" title="Add reaction">
          <SmilePlus size={14} strokeWidth={1.8} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={6}>
        <div className="flex gap-0.5 p-1">
          {choices.map((c) => (
            <Tooltip key={c} content={REACTIONS[c].name}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={REACTIONS[c].name}
                onClick={() => {
                  setOpen(false);
                  onPick(c);
                }}
              >
                <span aria-hidden className="text-base leading-none">
                  {REACTIONS[c].emoji}
                </span>
              </Button>
            </Tooltip>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
