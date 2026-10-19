import { Eye } from 'lucide-react';
import { Button } from '../../ui/Button';

interface Props {
  inReview: boolean;
  /** You're a requested reviewer who hasn't reviewed yet: the button stands out. */
  asked: boolean;
  onToggle: () => void;
}

/**
 * Starts a review of the PR: from then on what you write in its view is a PR
 * comment, not a note, until Submit (or a second click) ends it.
 */
export function ReviewButton({ inReview, asked, onToggle }: Props) {
  if (inReview) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={onToggle}
        title="Stop reviewing: what you write becomes a note again"
        className="rounded-full border-primary/40 bg-[hsl(var(--surface-2))] text-primary shadow-lg shadow-shade/20 hover:text-primary"
      >
        <Eye size={14} strokeWidth={1.8} />
        In review
      </Button>
    );
  }
  return (
    <Button
      variant={asked ? 'primary' : 'secondary'}
      size="sm"
      onClick={onToggle}
      title="Review: what you write becomes a PR comment, sent on Submit"
      className={`rounded-full shadow-lg shadow-shade/20 ${asked ? '' : 'bg-[hsl(var(--surface-2))]'}`}
    >
      <Eye size={14} strokeWidth={1.8} />
      {asked ? "Review · you're asked" : 'Review'}
    </Button>
  );
}
