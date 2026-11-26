import React from 'react';
import { Download, FolderOpen, Plus } from 'lucide-react';
import { ListRow } from '../ui/ListRow';

export type ProjectSource = 'local' | 'clone' | 'empty';

interface SourceStepProps {
  onPick: (source: ProjectSource) => void;
}

const SOURCES: { id: ProjectSource; icon: React.ReactNode; title: string; subtitle: string }[] = [
  {
    id: 'local',
    icon: <FolderOpen size={14} strokeWidth={1.8} />,
    title: 'Local folder',
    subtitle: 'A folder already on this Mac.',
  },
  {
    id: 'clone',
    icon: <Download size={14} strokeWidth={1.8} />,
    title: 'Clone a repository',
    subtitle: 'From a git URL or a template, into a folder you pick.',
  },
  {
    id: 'empty',
    icon: <Plus size={14} strokeWidth={1.8} />,
    title: 'Empty project',
    subtitle: 'A new folder, with git if you like.',
  },
];

export function SourceStep({ onPick }: SourceStepProps) {
  return (
    <div className="-mx-2.5 grid gap-0.5">
      {SOURCES.map((s) => (
        <ListRow key={s.id} leading={s.icon} description={s.subtitle} onClick={() => onPick(s.id)}>
          {s.title}
        </ListRow>
      ))}
    </div>
  );
}
