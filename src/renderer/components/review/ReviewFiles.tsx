import { Checkbox } from '../ui/Checkbox';
import { CountBadge } from '../ui/CountBadge';
import { DetailSection } from '../ui/DetailList';
import { LineStats } from '../ui/LineStats';
import { ListRow } from '../ui/ListRow';
import type { FileRow } from './outline';
import { rowKeys } from './rowAction';

/**
 * Every file the PR changes: its name (then its folder), a viewed tick,
 * unresolved threads (outlined count) and the person's comments (filled),
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
                    <CountBadge count={row.threads} tone="outline" title="Unresolved threads" />
                  )}
                  {row.drafts > 0 && <CountBadge count={row.drafts} title="Your comments" />}
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
