import React from 'react';
import { FolderOpen, Download, Plus } from 'lucide-react';

export type ProjectSource = 'local' | 'clone' | 'empty';

interface SourceStepProps {
  onPick: (source: ProjectSource) => void;
}

const CARDS: { id: ProjectSource; icon: React.ReactNode; title: string; subtitle: string }[] = [
  {
    id: 'local',
    icon: <FolderOpen size={18} className="text-foreground/70" strokeWidth={1.8} />,
    title: 'Local folder',
    subtitle: 'Open an existing directory',
  },
  {
    id: 'clone',
    icon: <Download size={18} className="text-foreground/70" strokeWidth={1.8} />,
    title: 'Clone repository',
    subtitle: 'From a Git URL or template — you pick where',
  },
  {
    id: 'empty',
    icon: <Plus size={18} className="text-foreground/70" strokeWidth={1.8} />,
    title: 'Empty project',
    subtitle: 'New directory, optional git init',
  },
];

export function SourceStep({ onPick }: SourceStepProps) {
  return (
    <div className="flex flex-col gap-3">
      {CARDS.map((card) => (
        <button
          key={card.id}
          onClick={() => onPick(card.id)}
          className="flex items-center gap-3 px-4 py-3.5 rounded-lg border border-border/60 hover:border-border hover:bg-accent/40 transition-all duration-150 text-left group"
        >
          <div className="w-9 h-9 rounded-lg bg-accent/80 flex items-center justify-center shrink-0 group-hover:bg-accent">
            {card.icon}
          </div>
          <div>
            <div className="text-[13px] font-medium text-foreground">{card.title}</div>
            <div className="text-[11px] text-muted-foreground/50">{card.subtitle}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
