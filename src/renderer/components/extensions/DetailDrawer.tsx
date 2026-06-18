import React from 'react';
import { X, Loader2, ChevronLeft, FileCode2 } from 'lucide-react';
import type { ExtensionsOverview } from '../../../shared/types';
import { IconButton } from '../ui/IconButton';
import {
  ComponentCard,
  KIND_STYLE,
  PLUGIN_STYLE,
  PILL,
  COMPONENT_GROUPS,
  countComponents,
} from './ExtensionCard';
import { pluginInstallScopes, skillInstallScopes } from './extensionDerivations';
import type { useExtensions, DetailRef } from './useExtensions';

type Ext = ReturnType<typeof useExtensions>;

function installedInLabel(ext: Ext, ref: DetailRef): string {
  const ov = ext.overview as ExtensionsOverview | null;
  if (!ov) return '';
  if (ref.kind === 'plugin') return pluginInstallScopes(ov, ref.pluginId).join(', ');
  if (ref.kind === 'skill') return skillInstallScopes(ov, ref.skillName).join(', ');
  return '';
}

/** A wrapped source block (SKILL.md / agent / command / hook config) + bundled files. */
function SourceBlock({ label, raw, files }: { label: string; raw?: string; files?: string[] }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-foreground/40">
        {label}
      </div>
      <pre
        className="whitespace-pre-wrap break-words rounded-lg px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground/80"
        style={{ background: 'hsl(var(--surface-0))' }}
      >
        {raw?.trim() || 'No source found.'}
      </pre>
      {files && files.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-foreground/40">
            Files · {files.length}
          </div>
          <div className="space-y-1">
            {files.map((f) => (
              <div
                key={f}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5 font-mono text-[11px] text-foreground/70"
                style={{ background: 'hsl(var(--surface-3))' }}
              >
                <FileCode2
                  size={12}
                  strokeWidth={1.8}
                  className="flex-shrink-0 text-foreground/40"
                />
                <span className="truncate">{f}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DetailDrawer({ ext }: { ext: Ext }) {
  const ref = ext.detail;
  if (!ref) return null;

  const meta = ref.kind === 'plugin' ? ext.catalog.find((c) => c.id === ref.pluginId) : undefined;
  const style =
    ref.kind === 'plugin'
      ? PLUGIN_STYLE
      : ref.kind === 'skill'
        ? KIND_STYLE.skill
        : KIND_STYLE[ref.componentKind];
  const HeaderIcon = style.Icon;
  const name = ref.kind === 'skill' ? ref.skillName : ref.name;
  const installedIn = installedInLabel(ext, ref);
  const skillDetail = ext.detailData.skill;
  const component = ext.detailData.component;

  const description =
    ref.kind === 'plugin'
      ? meta?.description
      : ref.kind === 'skill'
        ? skillDetail?.description
        : component?.description;

  const metaLine =
    ref.kind === 'plugin'
      ? [ref.marketplace || meta?.marketplace, ref.version || meta?.version, meta?.author]
          .filter(Boolean)
          .join(' · ')
      : ref.kind === 'skill'
        ? ref.fromRegistry
          ? 'from registry'
          : 'local'
        : `bundled in ${ref.pluginName}`;

  const sourceLabel =
    component?.kind === 'skill' ? 'SKILL.md' : component?.kind === 'hook' ? 'hooks.json' : 'Source';

  return (
    <>
      {/* in-modal scrim */}
      <div
        className="absolute inset-0 z-20 animate-fade-in bg-[hsl(0_0%_0%/0.45)]"
        onClick={ext.closeDetail}
      />
      <div
        className="absolute inset-y-0 right-0 z-30 flex w-[480px] max-w-[80%] animate-slide-in-right flex-col shadow-[-30px_0_70px_-20px_hsl(0_0%_0%/0.65)]"
        style={{ background: 'hsl(var(--surface-2))' }}
      >
        {/* header */}
        <div className="flex items-start gap-3 border-b border-border/40 px-5 py-4">
          <div
            className={`flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-lg ${style.accent}`}
          >
            <HeaderIcon size={18} strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            {ref.kind === 'plugin-component' && (
              <button
                onClick={() =>
                  void ext.openDetail({
                    kind: 'plugin',
                    pluginId: ref.pluginId,
                    name: ref.pluginName,
                    marketplace: '',
                  })
                }
                className="mb-1 inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
              >
                <ChevronLeft size={12} /> Part of {ref.pluginName}
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-semibold text-foreground">{name}</span>
              <span className={`${PILL} ${style.pill}`}>{style.label}</span>
            </div>
            <div className="mt-0.5 font-mono text-[10.5px] text-foreground/45">{metaLine}</div>
          </div>
          <IconButton onClick={ext.closeDetail} title="Close details">
            <X size={14} strokeWidth={2} />
          </IconButton>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {installedIn && (
            <div className="text-[11px] text-foreground/55">
              <span className="font-mono uppercase tracking-[0.1em] text-foreground/40">
                Installed in
              </span>
              <div className="mt-1 text-foreground/80">{installedIn}</div>
            </div>
          )}

          {description && (
            <p className="text-[12.5px] leading-relaxed text-foreground/80">{description}</p>
          )}

          {ext.detailLoading && (
            <div className="flex justify-center py-6 text-foreground/40">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}

          {/* plugin: bundled components, grouped by type — all clickable to detail */}
          {ref.kind === 'plugin' && !ext.detailLoading && (
            <div className="space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-foreground/40">
                Includes · {countComponents(ext.detailData.pluginComponents)} components
              </div>
              {COMPONENT_GROUPS.map(({ key, kind, label }) => {
                const items = ext.detailData.pluginComponents?.[key] ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-foreground/35">
                      {label} · {items.length}
                    </div>
                    {items.map((c) => (
                      <ComponentCard
                        key={c.name}
                        kind={kind}
                        title={c.name}
                        subtitle={c.description}
                        onOpen={() =>
                          void ext.openDetail({
                            kind: 'plugin-component',
                            pluginId: ref.pluginId,
                            pluginName: ref.name,
                            componentKind: kind,
                            name: c.name,
                            description: c.description,
                          })
                        }
                      />
                    ))}
                  </div>
                );
              })}
              {countComponents(ext.detailData.pluginComponents) === 0 && (
                <div className="text-[11px] text-foreground/40">
                  This plugin bundles no components.
                </div>
              )}
            </div>
          )}

          {/* standalone skill: full SKILL.md + files */}
          {ref.kind === 'skill' && !ext.detailLoading && skillDetail && (
            <SourceBlock label="SKILL.md" raw={skillDetail.raw} files={skillDetail.files} />
          )}

          {/* bundled component: its real source (+ files for skills) */}
          {ref.kind === 'plugin-component' && !ext.detailLoading && component && (
            <SourceBlock label={sourceLabel} raw={component.raw} files={component.files} />
          )}
        </div>
      </div>
    </>
  );
}
