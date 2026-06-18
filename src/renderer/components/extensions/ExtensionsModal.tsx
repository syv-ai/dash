import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Modal, useModalClose } from '../ui/Modal';
import { IconButton } from '../ui/IconButton';
import { Segmented } from '../ui/Segmented';
import { useExtensions, type ProjectInfo, type TaskInfo } from './useExtensions';
import { ScopeSidebar } from './ScopeSidebar';
import { ScopeDetail } from './ScopeDetail';
import { BrowseView } from './BrowseView';
import { DetailDrawer } from './DetailDrawer';

interface Props {
  projects: ProjectInfo[];
  activeTasks: TaskInfo[];
  onClose: () => void;
}

type TopMode = 'installed' | 'browse';

export function ExtensionsModal({ projects, activeTasks, onClose }: Props) {
  return (
    <Modal onClose={onClose} size="w-[1140px] max-w-[94vw] h-[90vh] max-h-[800px]">
      <ExtensionsBody projects={projects} activeTasks={activeTasks} />
    </Modal>
  );
}

function ExtensionsBody({
  projects,
  activeTasks,
}: {
  projects: ProjectInfo[];
  activeTasks: TaskInfo[];
}) {
  const handleClose = useModalClose();
  const ext = useExtensions(projects, activeTasks);
  const [mode, setMode] = useState<TopMode>('installed');
  const [selectedScopeId, setSelectedScopeId] = useState<string>('global');

  const scopes = ext.overview?.scopes ?? [];
  const selected = scopes.find((s) => s.scope.id === selectedScopeId) ?? scopes[0];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 flex-shrink-0 items-center justify-between gap-4 border-b border-border/40 px-5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[14px] font-semibold tracking-tight text-foreground">Extensions</h2>
          <span className="font-mono text-[11px] text-foreground/40">skills &amp; plugins</span>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            value={mode}
            onChange={(m) => setMode(m)}
            fullWidth={false}
            size="sm"
            options={[
              { value: 'installed', label: 'Installed' },
              { value: 'browse', label: 'Browse' },
            ]}
          />
          <IconButton onClick={handleClose} title="Close">
            <X size={14} strokeWidth={2} />
          </IconButton>
        </div>
      </div>

      {ext.error && (
        <div className="flex-shrink-0 border-b border-border/40 bg-destructive/10 px-5 py-2 text-[11px] text-destructive">
          {ext.error}
        </div>
      )}

      {/* Body */}
      <div className="relative flex min-h-0 flex-1">
        {mode === 'installed' ? (
          <>
            <ScopeSidebar
              scopes={scopes}
              selectedScopeId={selected?.scope.id ?? 'global'}
              onSelect={(id: string) => setSelectedScopeId(id)}
              loading={ext.loading}
            />
            <ScopeDetail scope={selected} ext={ext} />
          </>
        ) : (
          <BrowseView scopes={scopes.map((s) => s.scope)} ext={ext} />
        )}
        <DetailDrawer ext={ext} />
      </div>
    </div>
  );
}
