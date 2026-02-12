import React, { useState, useEffect, useRef } from 'react';
import { X, Check, AlertCircle, Sun, Moon, Terminal, RotateCcw } from 'lucide-react';
import type { KeyBindingMap, KeyBinding } from '../keybindings';
import {
  getBindingKeys,
  bindingFromEvent,
  DEFAULT_KEYBINDINGS,
  groupByCategory,
} from '../keybindings';
import { NOTIFICATION_SOUNDS, SOUND_LABELS } from '../sounds';
import type { NotificationSound } from '../sounds';

interface SettingsModalProps {
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  diffContextLines: number | null;
  onDiffContextLinesChange: (value: number | null) => void;
  notificationSound: NotificationSound;
  onNotificationSoundChange: (value: NotificationSound) => void;
  desktopNotification: boolean;
  onDesktopNotificationChange: (value: boolean) => void;
  keybindings: KeyBindingMap;
  onKeybindingsChange: (bindings: KeyBindingMap) => void;
  onClose: () => void;
}

function KeyCap({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-[24px] px-1.5 rounded-[5px] text-[11px] font-medium leading-none border border-border/80 bg-gradient-to-b from-white/[0.06] to-transparent text-foreground/80 shadow-[0_1px_0_1px_hsl(var(--border)/0.4),inset_0_1px_0_hsl(var(--foreground)/0.04)] font-mono">
      {label}
    </kbd>
  );
}

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-[3px]">
      {keys.map((k, i) => (
        <KeyCap key={i} label={k} />
      ))}
    </div>
  );
}

function KeyRecorder({
  binding,
  onChange,
}: {
  binding: KeyBinding;
  onChange: (b: KeyBinding) => void;
}) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        setRecording(false);
        return;
      }

      const result = bindingFromEvent(e);
      if (!result) return;

      onChange({ ...binding, ...result });
      setRecording(false);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recording, binding, onChange]);

  useEffect(() => {
    if (!recording && ref.current) ref.current.blur();
  }, [recording]);

  const keys = getBindingKeys(binding);

  return (
    <button
      ref={ref}
      onClick={() => setRecording(true)}
      className={`group/key flex items-center gap-1 px-2 py-1.5 rounded-lg transition-all duration-150 ${
        recording ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-accent/50'
      }`}
    >
      {recording ? (
        <span className="text-[11px] text-primary font-medium animate-pulse px-1">
          Press keys...
        </span>
      ) : (
        <KeyCombo keys={keys} />
      )}
    </button>
  );
}

export function SettingsModal({
  theme,
  onThemeChange,
  diffContextLines,
  onDiffContextLinesChange,
  notificationSound,
  onNotificationSoundChange,
  desktopNotification,
  onDesktopNotificationChange,
  keybindings,
  onKeybindingsChange,
  onClose,
}: SettingsModalProps) {
  const [tab, setTab] = useState<'general' | 'keybindings' | 'connections'>('general');
  const [claudeInfo, setClaudeInfo] = useState<{
    installed: boolean;
    version: string | null;
    path: string | null;
  } | null>(null);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    window.electronAPI.detectClaude().then((resp) => {
      if (resp.success) setClaudeInfo(resp.data ?? null);
    });
    window.electronAPI.getAppVersion().then((v) => setAppVersion(v));
  }, []);

  function handleBindingChange(id: string, updated: KeyBinding) {
    onKeybindingsChange({ ...keybindings, [id]: updated });
  }

  function handleResetAll() {
    onKeybindingsChange({ ...DEFAULT_KEYBINDINGS });
  }

  function handleResetOne(id: string) {
    if (DEFAULT_KEYBINDINGS[id]) {
      onKeybindingsChange({ ...keybindings, [id]: { ...DEFAULT_KEYBINDINGS[id] } });
    }
  }

  function isModified(binding: KeyBinding): boolean {
    const def = DEFAULT_KEYBINDINGS[binding.id];
    if (!def) return false;
    return (
      binding.mod !== def.mod ||
      binding.shift !== def.shift ||
      binding.alt !== def.alt ||
      binding.key !== def.key
    );
  }

  const groups = groupByCategory(keybindings);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[560px] max-h-[80vh] flex flex-col animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60 flex-shrink-0"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <h2 className="text-[14px] font-semibold text-foreground">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 px-5 border-b border-border/40">
          {(['general', 'keybindings', 'connections'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2.5 text-[12px] font-medium border-b-2 transition-all duration-150 capitalize ${
                tab === t
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1">
          {tab === 'general' && (
            <div className="space-y-6 animate-fade-in">
              {/* Theme */}
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground/70 mb-3">
                  Appearance
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onThemeChange('light')}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-lg text-[13px] border transition-all duration-150 ${
                      theme === 'light'
                        ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20'
                        : 'border-border/60 text-muted-foreground/60 hover:bg-accent/40 hover:text-foreground'
                    }`}
                  >
                    <Sun size={15} strokeWidth={1.8} />
                    Light
                  </button>
                  <button
                    onClick={() => onThemeChange('dark')}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-lg text-[13px] border transition-all duration-150 ${
                      theme === 'dark'
                        ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20'
                        : 'border-border/60 text-muted-foreground/60 hover:bg-accent/40 hover:text-foreground'
                    }`}
                  >
                    <Moon size={15} strokeWidth={1.8} />
                    Dark
                  </button>
                </div>
              </div>

              {/* Diff Context */}
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground/70 mb-3">
                  Diff Context
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {([null, 3, 10, 50] as const).map((value) => {
                    const isActive = diffContextLines === value;
                    const label = value === null ? 'Full file' : `${value} lines`;
                    return (
                      <button
                        key={String(value)}
                        onClick={() => onDiffContextLinesChange(value)}
                        className={`px-3 py-2.5 rounded-lg text-[12px] border transition-all duration-150 ${
                          isActive
                            ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20 font-medium'
                            : 'border-border/60 text-muted-foreground/60 hover:bg-accent/40 hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground/40 mt-2">
                  Number of unchanged lines shown around each change
                </p>
              </div>

              {/* Notification Sound */}
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground/70 mb-3">
                  Notification Sound
                </label>
                <div className="flex flex-wrap gap-2">
                  {NOTIFICATION_SOUNDS.map((sound) => {
                    const isActive = notificationSound === sound;
                    return (
                      <button
                        key={sound}
                        onClick={() => onNotificationSoundChange(sound)}
                        className={`px-3 py-2.5 rounded-lg text-[12px] border transition-all duration-150 ${
                          isActive
                            ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20 font-medium'
                            : 'border-border/60 text-muted-foreground/60 hover:bg-accent/40 hover:text-foreground'
                        }`}
                      >
                        {SOUND_LABELS[sound]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground/40 mt-2">
                  Play a sound when a task finishes and needs attention
                </p>
              </div>

              {/* Desktop Notification */}
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground/70 mb-3">
                  Desktop Notifications
                </label>
                <button
                  onClick={() => onDesktopNotificationChange(!desktopNotification)}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg text-[13px] border transition-all duration-150 ${
                    desktopNotification
                      ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20'
                      : 'border-border/60 text-muted-foreground/60 hover:bg-accent/40 hover:text-foreground'
                  }`}
                >
                  <div
                    className={`w-8 h-[18px] rounded-full relative transition-colors duration-150 flex-shrink-0 ${
                      desktopNotification ? 'bg-primary' : 'bg-border'
                    }`}
                  >
                    <div
                      className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-150 ${
                        desktopNotification ? 'translate-x-[16px]' : 'translate-x-[2px]'
                      }`}
                    />
                  </div>
                  Show macOS notification when a task finishes
                </button>
                <p className="text-[10px] text-muted-foreground/40 mt-2">
                  Notification will include the task name
                </p>
              </div>

              {/* Version */}
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground/70 mb-1.5">
                  Version
                </label>
                <p className="text-[13px] text-muted-foreground/50 font-mono">
                  {appVersion || '...'}
                </p>
              </div>
            </div>
          )}

          {tab === 'keybindings' && (
            <div className="space-y-5 animate-fade-in">
              {/* Header row */}
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground/40">
                  Click a shortcut to record a new binding
                </p>
                <button
                  onClick={handleResetAll}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-muted-foreground/40 hover:text-foreground hover:bg-accent/60 transition-all duration-150"
                >
                  <RotateCcw size={10} strokeWidth={2} />
                  Reset all
                </button>
              </div>

              {/* Grouped bindings */}
              {groups.map((group) => (
                <div key={group.category}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">
                      {group.category}
                    </span>
                    <div className="flex-1 h-px bg-border/30" />
                  </div>

                  <div
                    className="rounded-xl border border-border/40 overflow-hidden"
                    style={{ background: 'hsl(var(--surface-2))' }}
                  >
                    {group.items.map((binding, i) => {
                      const modified = isModified(binding);

                      return (
                        <div
                          key={binding.id}
                          className={`group flex items-center justify-between px-4 py-2.5 ${
                            i < group.items.length - 1 ? 'border-b border-border/20' : ''
                          } hover:bg-accent/20 transition-colors duration-100`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] text-foreground/80">{binding.label}</span>
                            {modified && (
                              <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            <KeyRecorder
                              binding={binding}
                              onChange={(updated) => handleBindingChange(binding.id, updated)}
                            />
                            {modified && (
                              <button
                                onClick={() => handleResetOne(binding.id)}
                                className="p-1.5 rounded-md text-muted-foreground/20 hover:text-foreground hover:bg-accent/60 opacity-0 group-hover:opacity-100 transition-all duration-150"
                                title="Reset to default"
                              >
                                <RotateCcw size={11} strokeWidth={2} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'connections' && (
            <div className="space-y-3 animate-fade-in">
              {/* Claude CLI */}
              <div
                className="flex items-start gap-3.5 p-4 rounded-xl border border-border/40"
                style={{ background: 'hsl(var(--surface-2))' }}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    claudeInfo?.installed
                      ? 'bg-[hsl(var(--git-added)/0.12)]'
                      : 'bg-[hsl(var(--git-modified)/0.12)]'
                  }`}
                >
                  {claudeInfo?.installed ? (
                    <Check size={14} className="text-[hsl(var(--git-added))]" strokeWidth={2.5} />
                  ) : (
                    <AlertCircle
                      size={14}
                      className="text-[hsl(var(--git-modified))]"
                      strokeWidth={2}
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Terminal size={12} className="text-muted-foreground/40" strokeWidth={2} />
                    <p className="text-[13px] font-medium text-foreground/90">Claude Code CLI</p>
                  </div>
                  {claudeInfo?.installed ? (
                    <div className="space-y-0.5">
                      <p className="text-[11px] text-muted-foreground/50 font-mono">
                        {claudeInfo.version}
                      </p>
                      <p className="text-[11px] text-muted-foreground/30 font-mono truncate">
                        {claudeInfo.path}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
                      Not found. Install with{' '}
                      <code className="px-1.5 py-0.5 rounded bg-accent/80 text-[10px] font-mono text-foreground/70">
                        npm install -g @anthropic-ai/claude-code
                      </code>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
