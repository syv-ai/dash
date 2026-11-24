import { MessageSquare, MessagesSquare, type LucideIcon } from 'lucide-react';
import { Checkbox } from '../ui/Checkbox';
import { DetailSection } from '../ui/DetailList';
import { LineStats } from '../ui/LineStats';
import { ListRow } from '../ui/ListRow';
import { Tooltip } from '../ui/Tooltip';
import { plural } from './labels';
import type { FileRow } from './outline';
import { rowKeys } from './rowAction';

/** A count with the icon of what it counts; the tooltip says it in words. */
function IconCount({
  icon: Icon,
  count,
  label,
}: {
  icon: LucideIcon;
  count: number;
  label: string;
}) {
  return (
    <Tooltip content={label} delay={300}>
      <span className="inline-flex items-center gap-0.5 text-xs tabular-nums" aria-label={label}>
        <Icon size={14} strokeWidth={1.8} />
        {count}
      </span>
    </Tooltip>
  );
}

/**
 * Every file the PR changes: its name (then its folder), a viewed tick,
 * unresolved threads and the person's comments (each an icon and a count),
 * and its line stats. A click opens it in the PR view.
 */
export function ReviewFiles({
  rows,
  activePath,
  onOpenFile,
  onSetViewed,
}: {
  rows: readonly FileRow[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onSetViewed: (row: FileRow, viewed: boolean) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <DetailSection title={`Files · ${rows.length}`} collapsible>
      <div className="grid gap-px">
        {rows.map((row) => {
          const { path, additions, deletions } = row.file;
          const slash = path.lastIndexOf('/');
          const open = () => onOpenFile(path);
          return (
            <ListRow
              key={path}
              as="div"
              role="button"
              tabIndex={0}
              size="sm"
              title={path}
              dimmed={row.viewed}
              selected={path === activePath}
              leading={
                <Checkbox
                  checked={row.viewed}
                  aria-label={row.viewed ? 'Mark not viewed' : 'Mark viewed'}
                  onChange={() => onSetViewed(row, !row.viewed)}
                />
              }
              trailing={
                <>
                  {row.threads > 0 && (
                    <IconCount
                      icon={MessagesSquare}
                      count={row.threads}
                      label={plural(row.threads, 'unresolved thread')}
                    />
                  )}
                  {row.drafts > 0 && (
                    <IconCount
                      icon={MessageSquare}
                      count={row.drafts}
                      label={plural(row.drafts, 'draft comment')}
                    />
                  )}
                  <span className="text-xs">
                    <LineStats add={additions} del={deletions} />
                  </span>
                </>
              }
              onClick={open}
              onKeyDown={rowKeys(open)}
            >
              {path.slice(slash + 1)}
              {slash > 0 && <span className="text-ink-3"> {path.slice(0, slash)}</span>}
            </ListRow>
          );
        })}
      </div>
    </DetailSection>
  );
}
