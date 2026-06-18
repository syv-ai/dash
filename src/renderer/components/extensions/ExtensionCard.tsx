import React, { useEffect, useState } from 'react';
import {
  Box,
  Sparkles,
  Bot,
  TerminalSquare,
  Webhook,
  Trash2,
  Loader2,
  ChevronDown,
  CornerDownRight,
  RotateCcw,
} from 'lucide-react';
import type {
  OverviewPlugin,
  OverviewSkill,
  PluginComponents,
  PluginComponentSummary,
  PluginComponentKind,
} from '../../../shared/types';
import type { Provenance } from './extensionDerivations';
import { Switch } from '../ui/Switch';
import { IconButton } from '../ui/IconButton';

const CARD = 'rounded-[13px] px-3.5 py-3 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)]';
const CARD_BG = { background: 'hsl(var(--surface-3))' } as const;
const NESTED_BG = { background: 'hsl(var(--surface-1))' } as const;
export const PILL =
  'rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.05em]';
const TILE = 'flex flex-shrink-0 items-center justify-center rounded-lg';

interface KindStyle {
  Icon: typeof Sparkles;
  accent: string;
  pill: string;
  label: string;
}

/** A plugin itself (not one of its components) — styled like KIND_STYLE so the card
 *  and the detail drawer share one source for the Box/primary look. */
export const PLUGIN_STYLE: KindStyle = {
  Icon: Box,
  accent: 'bg-primary/15 text-primary',
  pill: 'bg-primary/15 text-primary',
  label: 'Plugin',
};

/** Per-kind icon + accent classes, shared by every component card. */
export const KIND_STYLE: Record<PluginComponentKind, KindStyle> = {
  skill: {
    Icon: Sparkles,
    accent: 'bg-[hsl(var(--git-added)/0.13)] text-[hsl(var(--git-added))]',
    pill: 'bg-[hsl(var(--git-added)/0.15)] text-[hsl(var(--git-added))]',
    label: 'Skill',
  },
  agent: {
    Icon: Bot,
    accent: 'bg-primary/15 text-primary',
    pill: 'bg-primary/15 text-primary',
    label: 'Agent',
  },
  command: {
    Icon: TerminalSquare,
    accent: 'bg-[hsl(var(--warn)/0.13)] text-[hsl(var(--warn))]',
    pill: 'bg-[hsl(var(--warn)/0.15)] text-[hsl(var(--warn))]',
    label: 'Command',
  },
  hook: {
    Icon: Webhook,
    accent: 'bg-foreground/10 text-foreground/60',
    pill: 'bg-foreground/10 text-foreground/55',
    label: 'Hook',
  },
};

/** Small badge showing where an item comes from in the Global→Project→Task chain. */
export function ProvenanceBadge({ provenance }: { provenance?: Provenance }) {
  if (!provenance || provenance.kind === 'local') return null;
  const overridden = provenance.kind === 'overridden';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-medium ${
        overridden
          ? 'bg-[hsl(var(--warn)/0.15)] text-[hsl(var(--warn))]'
          : 'bg-foreground/10 text-foreground/45'
      }`}
    >
      <CornerDownRight size={10} strokeWidth={2} />
      {overridden ? `Overridden · from ${provenance.from}` : `Inherited from ${provenance.from}`}
    </span>
  );
}

/** The one card used for every component (standalone skill or plugin-bundled
 *  skill/agent/command/hook). Controls (toggle/remove/restore) go in `right`;
 *  bundled components pass none and are read-only. */
export function ComponentCard({
  kind,
  title,
  subtitle,
  provenance,
  onOpen,
  right,
  nested = false,
}: {
  kind: PluginComponentKind;
  title: string;
  subtitle?: React.ReactNode;
  provenance?: Provenance;
  onOpen?: () => void;
  right?: React.ReactNode;
  /** Render on a darker inset background (for lists nested inside another card). */
  nested?: boolean;
}) {
  const st = KIND_STYLE[kind];
  const Icon = st.Icon;
  const tileSize = nested ? 'h-[28px] w-[28px]' : 'h-[34px] w-[34px]';
  const iconSize = nested ? 14 : 16;
  return (
    <div
      className={`flex items-center gap-3 rounded-[13px] ${nested ? 'px-3 py-2' : 'px-3.5 py-3'} shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)]`}
      style={nested ? NESTED_BG : CARD_BG}
    >
      <div className={`${TILE} ${tileSize} ${st.accent}`}>
        <Icon size={iconSize} strokeWidth={1.8} />
      </div>
      <button
        onClick={onOpen}
        disabled={!onOpen}
        className={`min-w-0 flex-1 text-left ${onOpen ? '' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`truncate font-semibold text-foreground ${nested ? 'text-[12.5px]' : 'text-[14px]'} ${
              onOpen ? 'hover:underline' : ''
            }`}
          >
            {title}
          </span>
          <span className={`${PILL} ${st.pill}`}>{st.label}</span>
          <ProvenanceBadge provenance={provenance} />
        </div>
        {subtitle && (
          <span className="mt-0.5 block truncate font-mono text-[10.5px] text-foreground/40">
            {subtitle}
          </span>
        )}
      </button>
      {right}
    </div>
  );
}

/** Total bundled components across all four kinds. */
export function countComponents(c?: PluginComponents | null): number {
  if (!c) return 0;
  return c.skills.length + c.agents.length + c.commands.length + c.hooks.length;
}

/** Compact one-line breakdown of a plugin's bundled components, e.g. "2 skills · 1 agent". */
export function summarizeComponents(c: PluginComponents | null): string {
  if (!c) return '…';
  const parts: string[] = [];
  const add = (n: number, word: string) => {
    if (n > 0) parts.push(`${n} ${word}${n === 1 ? '' : 's'}`);
  };
  add(c.skills.length, 'skill');
  add(c.agents.length, 'agent');
  add(c.commands.length, 'command');
  add(c.hooks.length, 'hook');
  return parts.length ? parts.join(' · ') : 'no components';
}

/** The four plugin component kinds, in display order, mapping the PluginComponents
 *  key to its kind + section label. Shared by the inline expander and the drawer. */
export const COMPONENT_GROUPS = [
  { key: 'skills', kind: 'skill', label: 'Skills' },
  { key: 'agents', kind: 'agent', label: 'Agents' },
  { key: 'commands', kind: 'command', label: 'Commands' },
  { key: 'hooks', kind: 'hook', label: 'Hooks' },
] as const satisfies ReadonlyArray<{
  key: keyof PluginComponents;
  kind: PluginComponentKind;
  label: string;
}>;

function BusyToggle({
  busy,
  on,
  onToggle,
  label,
}: {
  busy: boolean;
  on: boolean;
  onToggle: (value: boolean) => void;
  label: string;
}) {
  if (busy) return <Loader2 size={16} className="animate-spin text-foreground/40" />;
  return <Switch enabled={on} onToggle={onToggle} aria-label={label} />;
}

export function PluginRow({
  plugin,
  provenance,
  busy,
  onToggle,
  onRemove,
  onOpenDetail,
  onOpenComponent,
  loadComponents,
}: {
  plugin: OverviewPlugin;
  provenance?: Provenance;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onOpenDetail: () => void;
  onOpenComponent: (kind: PluginComponentKind, component: PluginComponentSummary) => void;
  loadComponents: (pluginId: string) => Promise<PluginComponents>;
}) {
  const [open, setOpen] = useState(false);
  const [components, setComponents] = useState<PluginComponents | null>(null);
  // A purely inherited plugin is managed at its install scope — Claude Code has no
  // per-scope "restore", so we show it read-only here (no toggle/remove).
  const inherited = provenance?.kind === 'inherited';

  // Load the breakdown eagerly so the card shows its component count without an
  // expand (loadComponents is cached in useExtensions, so this is cheap on re-render).
  useEffect(() => {
    let active = true;
    void loadComponents(plugin.id).then((c) => {
      if (active) setComponents(c);
    });
    return () => {
      active = false;
    };
  }, [loadComponents, plugin.id]);

  const total = countComponents(components);

  return (
    <div className={CARD} style={CARD_BG}>
      <div className="flex items-center gap-3">
        <div className={`${TILE} h-[34px] w-[34px] ${PLUGIN_STYLE.accent}`}>
          <PLUGIN_STYLE.Icon size={16} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <button
            onClick={onOpenDetail}
            className="flex items-center gap-2 text-left hover:underline"
          >
            <span className="truncate text-[14px] font-semibold text-foreground">
              {plugin.name}
            </span>
            <span className={`${PILL} ${PLUGIN_STYLE.pill}`}>{PLUGIN_STYLE.label}</span>
            {plugin.version && (
              <span className="font-mono text-[10.5px] text-foreground/40">{plugin.version}</span>
            )}
            <ProvenanceBadge provenance={provenance} />
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={total === 0}
            className="mt-0.5 flex items-center gap-1 text-[11px] text-foreground/50 hover:text-foreground/80 disabled:cursor-default disabled:hover:text-foreground/50"
          >
            {summarizeComponents(components)}
            {total > 0 && (
              <ChevronDown
                size={11}
                className={`transition-transform ${open ? 'rotate-180' : ''}`}
              />
            )}
          </button>
        </div>
        {inherited ? (
          <span className="text-[10.5px] italic text-foreground/35">managed upstream</span>
        ) : (
          <>
            <BusyToggle
              busy={busy}
              on={plugin.enabled}
              onToggle={onToggle}
              label={`Enable ${plugin.name}`}
            />
            <IconButton onClick={onRemove} title="Remove from this scope" variant="destructive">
              <Trash2 size={14} strokeWidth={1.8} />
            </IconButton>
          </>
        )}
      </div>
      {open && components && (
        <div className="mt-2 ml-[46px] space-y-2">
          {COMPONENT_GROUPS.map(({ key, kind, label }) => {
            const items = components[key];
            if (items.length === 0) return null;
            return (
              <div key={key} className="space-y-1">
                <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-foreground/35">
                  {label}
                </div>
                {items.map((c) => (
                  <ComponentCard
                    key={c.name}
                    kind={kind}
                    title={c.name}
                    subtitle={c.description}
                    nested
                    onOpen={() => onOpenComponent(kind, c)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SkillRow({
  skill,
  provenance,
  canRemove = true,
  busy,
  onToggle,
  onRemove,
  onRestore,
  onOpenDetail,
}: {
  skill: OverviewSkill;
  provenance?: Provenance;
  /** False for inherited skills with no local folder — nothing to uninstall here. */
  canRemove?: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onRemove: () => void;
  onRestore?: () => void;
  onOpenDetail: () => void;
}) {
  const on = skill.visibility !== 'off';
  const overridden = provenance?.kind === 'overridden';
  return (
    <ComponentCard
      kind="skill"
      title={skill.name}
      subtitle={skill.fromRegistry ? 'from registry' : 'local'}
      provenance={provenance}
      onOpen={onOpenDetail}
      right={
        <>
          {overridden && onRestore && (
            <IconButton onClick={onRestore} title="Restore inherited setting">
              <RotateCcw size={14} strokeWidth={1.8} />
            </IconButton>
          )}
          <BusyToggle busy={busy} on={on} onToggle={onToggle} label={`Enable ${skill.name}`} />
          {canRemove && (
            <IconButton onClick={onRemove} title="Remove from this scope" variant="destructive">
              <Trash2 size={14} strokeWidth={1.8} />
            </IconButton>
          )}
        </>
      }
    />
  );
}
