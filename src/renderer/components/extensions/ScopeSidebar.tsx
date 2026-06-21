import React, { useState } from 'react';
import { Globe, Folder, SquareTerminal, Loader2, ChevronRight } from 'lucide-react';
import type { ScopeExtensions } from '../../../shared/types';
import { buildScopeTree } from './scopeTargets';
import { CountBadge } from '../ui/CountBadge';

export function ScopeSidebar({
  scopes,
  selectedScopeId,
  onSelect,
  loading,
}: {
  scopes: ScopeExtensions[];
  selectedScopeId: string;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  const tree = buildScopeTree(scopes.map((s) => s.scope));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const countFor = (id: string) => {
    const s = scopes.find((x) => x.scope.id === id);
    return s ? s.plugins.length + s.skills.length : 0;
  };

  const Row = ({
    id,
    label,
    icon,
    indent,
    chevron,
  }: {
    id: string;
    label: string;
    icon: React.ReactNode;
    indent?: boolean;
    chevron?: { open: boolean; onToggle: () => void };
  }) => {
    const active = selectedScopeId === id;
    const count = countFor(id);
    return (
      <div
        className={`group flex items-center rounded-md ${
          active
            ? 'bg-[hsl(var(--surface-3))] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.05)]'
            : 'hover:bg-accent/50'
        }`}
      >
        {chevron ? (
          <button
            onClick={chevron.onToggle}
            className="flex-shrink-0 py-1.5 pl-1.5 pr-0.5 text-foreground/35 hover:text-foreground/70"
            aria-label={chevron.open ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              size={12}
              className={`transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                chevron.open ? 'rotate-90' : ''
              }`}
            />
          </button>
        ) : (
          <span className={indent ? 'w-6 flex-shrink-0' : 'w-2 flex-shrink-0'} />
        )}
        <button
          onClick={() => onSelect(id)}
          className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-[12.5px] transition-colors duration-150 ${
            active ? 'text-foreground' : 'text-foreground/60 group-hover:text-foreground'
          }`}
        >
          <span className={active ? 'text-foreground/80' : 'text-foreground/40'}>{icon}</span>
          <span className="truncate">{label}</span>
          {count > 0 && <CountBadge count={count} className="ml-auto" />}
        </button>
      </div>
    );
  };

  return (
    <div className="w-[262px] flex-shrink-0 space-y-0.5 overflow-y-auto border-r border-border/40 p-2">
      {loading && (
        <div className="flex justify-center p-4 text-foreground/40">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
      {tree.global && (
        <Row id={tree.global.id} label="Global" icon={<Globe size={14} strokeWidth={1.8} />} />
      )}
      {tree.projects.map(({ project, tasks }) => {
        const open = !collapsed.has(project.id);
        return (
          <div key={project.id} className="pt-1">
            <Row
              id={project.id}
              label={project.name}
              icon={<Folder size={14} strokeWidth={1.8} />}
              chevron={tasks.length > 0 ? { open, onToggle: () => toggle(project.id) } : undefined}
            />
            <div className="collapse-grid" data-open={open}>
              <div className="space-y-0.5">
                {tasks.map((t) => (
                  <Row
                    key={t.id}
                    id={t.id}
                    label={t.name}
                    icon={<SquareTerminal size={13} strokeWidth={1.8} />}
                    indent
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
