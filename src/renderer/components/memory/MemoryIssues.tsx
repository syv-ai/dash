import type { ReactNode } from 'react';
import { MEMORY_INDEX_FILE } from '../../../shared/types';
import type { MemoryEntry } from '../../../shared/types';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import {
  KNOWN_MEMORY_TYPES,
  MEMORY_TYPE_LABELS,
  type BrokenLink,
  type KnownMemoryType,
  type MemoryIssue,
} from './memoryView';

interface Props {
  issues: MemoryIssue[];
  broken: BrokenLink[];
  /** The memories a broken link can be pointed at instead. */
  candidates: MemoryEntry[];
  onRepoint: (link: BrokenLink, to: MemoryEntry) => void;
  onUnlink: (link: BrokenLink) => void;
  /** The fixes only a saved memory has; the editor leaves them out. */
  onCreate?: (name: string) => void;
  onIndex?: () => void;
  /** Left out when the memory's index line isn't its own to move. */
  onRaise?: () => void;
  onRetype?: (type: KnownMemoryType) => void;
}

/**
 * What is off about one memory, a line each, with what can be done about it
 * right there. Shown above the memory, and above a draft for its links.
 */
export function MemoryIssues(props: Props) {
  const { issues, broken, candidates, onRepoint, onUnlink } = props;
  const rows: ReactNode[] = [];
  if (issues.includes('unindexed') && props.onIndex) {
    rows.push(
      <Row key="unindexed" text={`Not in ${MEMORY_INDEX_FILE}, so Claude never recalls it.`}>
        <Button variant="secondary" size="sm" onClick={props.onIndex}>
          Add to index
        </Button>
      </Row>,
    );
  }
  if (issues.includes('not-loaded')) {
    rows.push(
      <Row
        key="not-loaded"
        text={
          props.onRaise
            ? `Its line sits past the part of ${MEMORY_INDEX_FILE} Claude loads. Moved to the top it is seen, and the last line in that part falls past the cut instead.`
            : `Its line sits past the part of ${MEMORY_INDEX_FILE} Claude loads, and isn't a line of its own that can be moved: edit the index by hand.`
        }
      >
        {props.onRaise && (
          <Button variant="secondary" size="sm" onClick={props.onRaise}>
            Move to top
          </Button>
        )}
      </Row>,
    );
  }
  if (issues.includes('untyped') && props.onRetype) {
    const { onRetype } = props;
    rows.push(
      <Row key="untyped" text="No known type, so it isn't filed with the rest. File it as:">
        {KNOWN_MEMORY_TYPES.map((type) => (
          <Button key={type} variant="secondary" size="sm" onClick={() => onRetype(type)}>
            {MEMORY_TYPE_LABELS[type]}
          </Button>
        ))}
      </Row>,
    );
  }
  for (const link of broken) {
    const suggested = candidates.find((e) => e.file === link.suggestion);
    const { onCreate } = props;
    rows.push(
      <Row
        key={`${link.kind}:${link.target}`}
        text={
          link.kind === 'ref'
            ? `[[${link.target}]] has no memory yet.`
            : `Links to ${link.target}, which doesn't exist.`
        }
      >
        {link.kind === 'ref' && onCreate && (
          <Button variant="secondary" size="sm" onClick={() => onCreate(link.target)}>
            Write it
          </Button>
        )}
        {suggested && (
          <Button
            variant="secondary"
            size="sm"
            className="max-w-[200px]"
            title={suggested.file}
            onClick={() => onRepoint(link, suggested)}
          >
            <span className="truncate">Point at “{suggested.name}”</span>
          </Button>
        )}
        {candidates.length > 0 && (
          <Select
            value=""
            onValueChange={(file) => {
              const to = candidates.find((e) => e.file === file);
              if (to) onRepoint(link, to);
            }}
            options={candidates.map((e) => ({ value: e.file, label: e.name }))}
            placeholder="Point at…"
            // The header's project picker overrides the same two, so these are known to win.
            className="w-auto px-2 py-1"
            contentClassName="max-w-[320px]"
          />
        )}
        <Button variant="ghost" size="sm" onClick={() => onUnlink(link)}>
          Unlink
        </Button>
      </Row>,
    );
  }
  if (rows.length === 0) return null;
  return <div className="shrink-0 border-b border-border/40 bg-surface-2">{rows}</div>;
}

function Row(props: { text: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-1.5 text-[11px] text-muted-foreground">
      <span className="min-w-0">{props.text}</span>
      <div className="flex shrink-0 items-center gap-1.5">{props.children}</div>
    </div>
  );
}
