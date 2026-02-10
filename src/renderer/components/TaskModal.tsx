import React, { useState } from 'react';
import { X, GitBranch, Zap } from 'lucide-react';

interface TaskModalProps {
  onClose: () => void;
  onCreate: (name: string, useWorktree: boolean, autoApprove: boolean) => void;
}

export function TaskModal({ onClose, onCreate }: TaskModalProps) {
  const [name, setName] = useState('');
  const [useWorktree, setUseWorktree] = useState(true);
  const [autoApprove, setAutoApprove] = useState(() => localStorage.getItem('yoloMode') === 'true');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) {
      onCreate(name.trim(), useWorktree, autoApprove);
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[420px] animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-border/60" style={{ background: 'hsl(var(--surface-2))' }}>
          <h2 className="text-[14px] font-semibold text-foreground">New Task</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5">
          {/* Task name */}
          <div className="mb-5">
            <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
              Task name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fix auth bug, Add dark mode..."
              className="w-full px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
              autoFocus
            />
          </div>

          {/* Worktree toggle */}
          <div className="mb-4">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={useWorktree}
                  onChange={(e) => setUseWorktree(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-8 h-[18px] rounded-full bg-accent peer-checked:bg-primary/80 transition-colors duration-200" />
                <div className="absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-muted-foreground/40 peer-checked:bg-primary-foreground peer-checked:translate-x-[14px] transition-all duration-200" />
              </div>
              <div className="flex items-center gap-2">
                <GitBranch size={13} className="text-muted-foreground/40" strokeWidth={1.8} />
                <span className="text-[13px] text-foreground/80">Git worktree</span>
                <span className="text-[11px] text-muted-foreground/40">isolated branch</span>
              </div>
            </label>
          </div>

          {/* Yolo mode toggle */}
          <div className="mb-6">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={autoApprove}
                  onChange={(e) => {
                    setAutoApprove(e.target.checked);
                    localStorage.setItem('yoloMode', String(e.target.checked));
                  }}
                  className="sr-only peer"
                />
                <div className="w-8 h-[18px] rounded-full bg-accent peer-checked:bg-primary/80 transition-colors duration-200" />
                <div className="absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-muted-foreground/40 peer-checked:bg-primary-foreground peer-checked:translate-x-[14px] transition-all duration-200" />
              </div>
              <div className="flex items-center gap-2">
                <Zap size={13} className="text-muted-foreground/40" strokeWidth={1.8} />
                <span className="text-[13px] text-foreground/80">Yolo mode</span>
                <span className="text-[11px] text-muted-foreground/40">skip permissions</span>
              </div>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-2.5 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-all duration-150"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-5 py-2 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
            >
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
