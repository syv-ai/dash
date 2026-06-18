import React, { useMemo, useState } from 'react';
import {
  Globe,
  Folder,
  SquareTerminal,
  ChevronRight,
  Check,
  Download,
  Loader2,
} from 'lucide-react';
import type { ExtensionScopeRef } from '../../../shared/types';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/Popover';
import { Button } from '../ui/Button';
import { buildScopeTree } from './scopeTargets';

/** A multi-select scope picker in a popover: Global + each project (expandable to
 *  its tasks). Selecting does not close the popover; a footer button fans the add
 *  out to every checked scope. Already-installed scopes are shown checked + locked.
 *  ESC closes only the popover (the Modal defers Esc to Radix poppers). */
export function ScopeMultiSelect({
  scopes,
  installedScopeIds,
  busy,
  onAdd,
  children,
}: {
  scopes: ExtensionScopeRef[];
  /** Scope ids that already have this item — rendered checked + disabled. */
  installedScopeIds: Set<string>;
  busy: boolean;
  onAdd: (targets: ExtensionScopeRef[]) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildScopeTree(scopes), [scopes]);
  const byId = useMemo(() => new Map(scopes.map((s) => [s.id, s])), [scopes]);

  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = () => {
    const targets = [...selected].map((id) => byId.get(id)).filter(Boolean) as ExtensionScopeRef[];
    if (targets.length === 0) return;
    onAdd(targets);
    setSelected(new Set());
    setOpen(false);
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
    const installed = installedScopeIds.has(id);
    const checked = installed || selected.has(id);
    return (
      <div className="flex items-center">
        {chevron ? (
          <button
            onClick={chevron.onToggle}
            className="flex-shrink-0 p-1 text-foreground/35 hover:text-foreground/70"
            aria-label={chevron.open ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              size={12}
              className={`transition-transform ${chevron.open ? 'rotate-90' : ''}`}
            />
          </button>
        ) : (
          <span className={indent ? 'w-7 flex-shrink-0' : 'w-6 flex-shrink-0'} />
        )}
        <button
          onClick={() => !installed && toggleSel(id)}
          disabled={installed}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] transition-colors ${
            installed
              ? 'cursor-default text-foreground/40'
              : 'text-foreground/80 hover:bg-accent/50'
          }`}
        >
          <span
            className={`flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded-[4px] border ${
              checked ? 'border-transparent bg-primary text-primary-foreground' : 'border-border/70'
            }`}
          >
            {checked && <Check size={11} strokeWidth={3} />}
          </span>
          <span className="text-foreground/45">{icon}</span>
          <span className="truncate">{label}</span>
          {installed && <span className="ml-auto text-[10px] text-foreground/35">installed</span>}
        </button>
      </div>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="w-[260px] p-0">
        <div className="max-h-[280px] overflow-y-auto p-1.5">
          {tree.global && (
            <Row id={tree.global.id} label="Global" icon={<Globe size={13} strokeWidth={1.8} />} />
          )}
          {tree.projects.map(({ project, tasks }) => (
            <div key={project.id}>
              <Row
                id={project.id}
                label={project.name}
                icon={<Folder size={13} strokeWidth={1.8} />}
                chevron={
                  tasks.length > 0
                    ? { open: expanded.has(project.id), onToggle: () => toggleExpand(project.id) }
                    : undefined
                }
              />
              {expanded.has(project.id) &&
                tasks.map((t) => (
                  <Row
                    key={t.id}
                    id={t.id}
                    label={t.name}
                    icon={<SquareTerminal size={12} strokeWidth={1.8} />}
                    indent
                  />
                ))}
            </div>
          ))}
        </div>
        <div className="border-t border-border/50 p-2">
          <Button
            size="sm"
            className="w-full"
            disabled={selected.size === 0 || busy}
            onClick={confirm}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {selected.size > 0
              ? `Add to ${selected.size} ${selected.size === 1 ? 'scope' : 'scopes'}`
              : 'Select scopes'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
