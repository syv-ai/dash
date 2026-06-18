import React, { useState } from 'react';
import { Globe, Folder, SquareTerminal, PackageOpen } from 'lucide-react';
import type { ScopeExtensions } from '../../../shared/types';
import { PluginRow, SkillRow } from './ExtensionCard';
import { CascadeConfirm } from './CascadeConfirm';
import {
  effectivePlugins,
  effectiveSkills,
  inheritingTaskCount,
  type EffectivePlugin,
  type EffectiveSkill,
} from './extensionDerivations';
import { Expandable } from '../ui/Expandable';
import type { useExtensions } from './useExtensions';

type Ext = ReturnType<typeof useExtensions>;

const SCOPE_META: Record<
  ScopeExtensions['scope']['kind'],
  { icon: React.ReactNode; note: string }
> = {
  global: { icon: <Globe size={15} strokeWidth={1.8} />, note: 'Available in every project' },
  project: {
    icon: <Folder size={15} strokeWidth={1.8} />,
    note: 'Shared with this project (committed)',
  },
  task: {
    icon: <SquareTerminal size={15} strokeWidth={1.8} />,
    note: 'Inherits Global + project; overrides apply to this worktree only',
  },
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-foreground/75">
      {children}
    </h3>
  );
}

interface PendingAction {
  message: string;
  confirmLabel: string;
  run: () => void;
}

export function ScopeDetail({ scope, ext }: { scope?: ScopeExtensions; ext: Ext }) {
  const [pending, setPending] = useState<PendingAction | null>(null);

  if (!scope) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-foreground/40">
        Select a scope.
      </div>
    );
  }
  const s = scope.scope;
  const meta = SCOPE_META[s.kind];
  const overview = ext.overview;
  const plugins = overview ? effectivePlugins(overview, scope) : [];
  const skills = overview ? effectiveSkills(overview, scope) : [];
  const empty = plugins.length + skills.length === 0;

  // A change at Project scope cascades to its task worktrees; warn before reducing
  // availability (disable/remove). Other scopes apply only to themselves.
  const inheritingTasks =
    s.kind === 'project' && overview ? inheritingTaskCount(overview, s.id) : 0;
  const guardReducing = (run: () => void, verb: string, name: string) => {
    if (inheritingTasks > 0) {
      const n = inheritingTasks;
      setPending({
        run,
        confirmLabel: verb,
        message: `${n} task worktree${n === 1 ? '' : 's'} in ${s.name} inherit${
          n === 1 ? 's' : ''
        } “${name}”. ${verb} here will affect ${n === 1 ? 'it' : 'them'} too.`,
      });
    } else {
      run();
    }
  };

  const renderPlugin = ({ plugin: p, provenance }: EffectivePlugin) => (
    <PluginRow
      key={p.id}
      plugin={p}
      provenance={provenance}
      busy={ext.busy === `${s.id}:${p.id}`}
      onToggle={(enabled) => {
        const run = () => void ext.setPluginEnabled(p.id, s, enabled);
        if (!enabled) guardReducing(run, 'Disable', p.name);
        else run();
      }}
      onRemove={() => guardReducing(() => void ext.removePlugin(p.id, s), 'Remove', p.name)}
      onOpenDetail={() =>
        void ext.openDetail({
          kind: 'plugin',
          pluginId: p.id,
          name: p.name,
          marketplace: p.marketplace,
          version: p.version,
        })
      }
      onOpenComponent={(componentKind, c) =>
        void ext.openDetail({
          kind: 'plugin-component',
          pluginId: p.id,
          pluginName: p.name,
          componentKind,
          name: c.name,
          description: c.description,
        })
      }
      loadComponents={ext.loadPluginComponents}
    />
  );

  const renderSkill = (sk: EffectiveSkill) => (
    <SkillRow
      key={sk.name}
      skill={sk}
      provenance={sk.provenance}
      // Only a skill genuinely added in THIS scope ('local') is removable here. An
      // inherited or overridden-but-shared skill's folder lives in (or is the committed
      // copy of) an ancestor — uninstalling it would delete that shared file. For those,
      // Restore (clear the override) is the right affordance, not Remove.
      canRemove={sk.provenance.kind === 'local'}
      busy={ext.busy === `${s.id}:${sk.name}`}
      onToggle={(on) => {
        const run = () => void ext.setSkillVisibility(sk.name, s, on ? null : 'off');
        if (!on) guardReducing(run, 'Disable', sk.name);
        else run();
      }}
      onRemove={() => guardReducing(() => void ext.removeSkill(sk.name, s), 'Remove', sk.name)}
      onRestore={() => void ext.setSkillVisibility(sk.name, s, null)}
      onOpenDetail={() =>
        void ext.openDetail({
          kind: 'skill',
          skillName: sk.name,
          fromRegistry: sk.fromRegistry,
          // Read SKILL.md from where the folder actually lives (an inherited skill's
          // file is in its owner scope, not necessarily here).
          source: { kind: 'scope', scope: sk.ownerScope },
        })
      }
    />
  );

  const ownPlugins = plugins.filter((p) => p.provenance.kind !== 'inherited');
  const inheritedPlugins = plugins.filter((p) => p.provenance.kind === 'inherited');
  const ownSkills = skills.filter((sk) => sk.provenance.kind !== 'inherited');
  const inheritedSkills = skills.filter((sk) => sk.provenance.kind === 'inherited');

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="text-foreground/70">{meta.icon}</span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight text-foreground">{s.name}</div>
          <div className="font-mono text-[10.5px] text-foreground/40">{meta.note}</div>
        </div>
      </div>

      {empty ? (
        <div
          className="flex flex-col items-center gap-2 rounded-[13px] px-6 py-12 text-center shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.2)]"
          style={{ background: 'hsl(var(--surface-0))' }}
        >
          <PackageOpen size={22} strokeWidth={1.6} className="text-foreground/30" />
          <div className="text-[12.5px] text-foreground/70">Nothing here or inherited yet</div>
          <div className="max-w-[280px] text-[11px] leading-relaxed text-foreground/45">
            Switch to <span className="font-medium text-foreground/65">Browse</span> to add a skill
            or plugin to {s.kind === 'global' ? 'every project' : s.name}.
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {plugins.length > 0 && (
            <section>
              <SectionLabel>Plugins · {plugins.length}</SectionLabel>
              {ownPlugins.length > 0 && (
                <div className="space-y-1.5">{ownPlugins.map(renderPlugin)}</div>
              )}
              {inheritedPlugins.length > 0 && (
                <div className={ownPlugins.length > 0 ? 'mt-2' : ''}>
                  <Expandable
                    label={`Inherited · ${inheritedPlugins.length}`}
                    defaultOpen={ownPlugins.length === 0}
                  >
                    <div className="space-y-1.5">{inheritedPlugins.map(renderPlugin)}</div>
                  </Expandable>
                </div>
              )}
            </section>
          )}
          {skills.length > 0 && (
            <section className={plugins.length > 0 ? 'border-t border-border/40 pt-5' : ''}>
              <SectionLabel>Stand-alone skills · {skills.length}</SectionLabel>
              {ownSkills.length > 0 && (
                <div className="space-y-1.5">{ownSkills.map(renderSkill)}</div>
              )}
              {inheritedSkills.length > 0 && (
                <div className={ownSkills.length > 0 ? 'mt-2' : ''}>
                  <Expandable
                    label={`Inherited · ${inheritedSkills.length}`}
                    defaultOpen={ownSkills.length === 0}
                  >
                    <div className="space-y-1.5">{inheritedSkills.map(renderSkill)}</div>
                  </Expandable>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {pending && (
        <CascadeConfirm
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          onConfirm={() => {
            pending.run();
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
