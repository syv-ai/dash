import { useState } from 'react';
import {
  Copy,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  ScrollText,
  Square,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Block, IconAction, IconName, RowBlock } from '@shared/addon-api';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { ProgressBar } from '../ui/ProgressBar';
import { Tooltip } from '../ui/Tooltip';

/** Maps the add-on API's fixed icon names to lucide components. */
export const ADDON_ICONS: Record<IconName, LucideIcon> = {
  play: Play,
  square: Square,
  'scroll-text': ScrollText,
  'external-link': ExternalLink,
  copy: Copy,
  'refresh-cw': RefreshCw,
  x: X,
};

/** Status dot colours, as the ports list has always shown them. */
const STATUS_DOT: Record<NonNullable<RowBlock['status']>, string> = {
  up: 'bg-[hsl(var(--git-added))] shadow-[0_0_6px_hsl(var(--git-added)/0.55)]',
  down: 'bg-foreground/25',
  unknown: 'bg-foreground/40 animate-pulse',
};

const TEXT_TONE = {
  muted: 'text-muted-fade-80',
  error: 'text-destructive',
  success: 'text-[hsl(var(--git-added))]',
} as const;

export type RunAction = (actionId: string) => Promise<void>;

/**
 * Renders an add-on's blocks with Dash's own primitives. Actions go back to
 * the add-on through `onAction`; a button shows a spinner until it resolves.
 */
export function AddonBlocks({ blocks, onAction }: { blocks: Block[]; onAction: RunAction }) {
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} onAction={onAction} />
      ))}
    </div>
  );
}

function BlockView({ block, onAction }: { block: Block; onAction: RunAction }) {
  switch (block.type) {
    case 'text':
      return (
        <p
          className={`text-[12px] leading-relaxed whitespace-pre-wrap ${
            block.tone ? TEXT_TONE[block.tone] : 'text-fg-fade-80'
          }`}
        >
          {block.text}
        </p>
      );
    case 'button':
      return <ActionButton block={block} onAction={onAction} />;
    case 'progress':
      return (
        <div className="flex flex-col gap-1.5">
          {block.label && <span className="text-[11.5px] text-muted-fade-80">{block.label}</span>}
          <ProgressBar
            percent={block.value === undefined ? undefined : block.value * 100}
            label={block.label}
          />
        </div>
      );
    case 'code':
      return (
        <div className="flex flex-col gap-1">
          {block.label && <span className="text-[11px] text-muted-fade-80">{block.label}</span>}
          <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words rounded-md bg-surface-1 border border-border/40 px-2.5 py-2 max-h-64 overflow-auto">
            {block.text}
          </pre>
        </div>
      );
    case 'row':
      return (
        <ul className="flex flex-col">
          <Row row={block} onAction={onAction} />
        </ul>
      );
    case 'list':
      return (
        <ul className="flex flex-col gap-0.5">
          {block.rows.map((row, i) => (
            <Row key={`${row.label}:${i}`} row={row} onAction={onAction} />
          ))}
        </ul>
      );
  }
}

function useBusy(onAction: RunAction) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = (id: string) => {
    if (busy) return;
    setBusy(id);
    void onAction(id).finally(() => setBusy(null));
  };
  return { busy, run };
}

function ActionButton({
  block,
  onAction,
}: {
  block: Extract<Block, { type: 'button' }>;
  onAction: RunAction;
}) {
  const { busy, run } = useBusy(onAction);
  const spinning = block.busy || busy === block.id;
  return (
    <div>
      <Button
        size="sm"
        variant={block.primary ? 'primary' : 'secondary'}
        disabled={spinning}
        onClick={() => run(block.id)}
      >
        {spinning && <Loader2 size={11} strokeWidth={2} className="animate-spin" />}
        {block.label}
      </Button>
    </div>
  );
}

function Row({ row, onAction }: { row: RowBlock; onAction: RunAction }) {
  const { busy, run } = useBusy(onAction);
  const label = (
    <>
      <span className="text-[11.5px] text-foreground truncate min-w-0 flex-1">{row.label}</span>
      {row.meta && (
        <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums shrink-0">
          {row.meta}
        </span>
      )}
    </>
  );
  const body = row.onClick ? (
    <button
      type="button"
      onClick={() => run(row.onClick!)}
      className="flex-1 min-w-0 flex items-center gap-2 text-left"
    >
      {label}
    </button>
  ) : (
    <div className="flex-1 min-w-0 flex items-center gap-2">{label}</div>
  );
  return (
    <li className="group/row flex items-center gap-1.5 pl-1.5 pr-0.5 py-1.5 rounded hover:bg-accent">
      {row.status && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[row.status]}`}
          aria-hidden
        />
      )}
      {row.tooltip ? <Tooltip content={row.tooltip}>{body}</Tooltip> : body}
      {row.actions?.map((a) => (
        <RowAction key={a.id} action={a} busy={busy === a.id} onRun={() => run(a.id)} />
      ))}
    </li>
  );
}

function RowAction({
  action,
  busy,
  onRun,
}: {
  action: IconAction;
  busy: boolean;
  onRun: () => void;
}) {
  const Icon = ADDON_ICONS[action.icon];
  return (
    <IconButton
      title={action.tooltip}
      size="sm"
      variant={action.icon === 'square' || action.icon === 'x' ? 'destructive' : 'default'}
      disabled={busy}
      onClick={onRun}
    >
      {busy ? (
        <Loader2 size={10} strokeWidth={2} className="animate-spin" />
      ) : (
        <Icon size={10} strokeWidth={2} />
      )}
    </IconButton>
  );
}

/** One line for a surface that threw or returned invalid blocks. */
export function AddonSurfaceError({ message }: { message: string }) {
  return <p className="text-[11.5px] text-destructive">{message}</p>;
}

/** Wrapper for icon actions in a drawer header. */
export function AddonHeaderActions({
  actions,
  onAction,
}: {
  actions: IconAction[];
  onAction: RunAction;
}) {
  const { busy, run } = useBusy(onAction);
  return (
    <>
      {actions.map((a) => (
        <RowAction key={a.id} action={a} busy={busy === a.id} onRun={() => run(a.id)} />
      ))}
    </>
  );
}
