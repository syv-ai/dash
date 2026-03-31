import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Check,
  AlertCircle,
  Sun,
  Moon,
  RotateCcw,
  Download,
  Pencil,
  Trash2,
  Plus,
  ExternalLink,
} from 'lucide-react';
import { Tooltip } from './ui/Tooltip';
import type { KeyBindingMap, KeyBinding } from '../keybindings';
import {
  getBindingKeys,
  bindingFromEvent,
  DEFAULT_KEYBINDINGS,
  groupByCategory,
} from '../keybindings';
import { NOTIFICATION_SOUNDS, SOUND_LABELS } from '../sounds';
import type { NotificationSound } from '../sounds';
import { TERMINAL_THEMES } from '../terminal/terminalThemes';
import type {
  PixelAgentsConfig,
  PixelAgentsStatus,
  PixelAgentsOffice,
  PixelAgentsOfficeStatus,
  StatusLineData,
  RateLimits,
  UsageThresholds,
} from '../../shared/types';
import { formatTokens, formatDuration, formatResetTime } from '../../shared/format';
import { UsageBar } from './ui/UsageBar';

const DASH_DEFAULT_ATTRIBUTION =
  '\n\nCo-Authored-By: Claude <noreply@anthropic.com> via Dash <dash@syv.ai>';

type SettingsTab = 'general' | 'appearance' | 'keybindings' | 'usage' | 'pixel-agents';

interface SettingsModalProps {
  initialTab?: string;
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  diffContextLines: number | null;
  onDiffContextLinesChange: (value: number | null) => void;
  notificationSound: NotificationSound;
  onNotificationSoundChange: (value: NotificationSound) => void;
  desktopNotification: boolean;
  onDesktopNotificationChange: (value: boolean) => void;
  shellDrawerEnabled: boolean;
  onShellDrawerEnabledChange: (value: boolean) => void;
  shellDrawerPosition: 'left' | 'main' | 'right';
  onShellDrawerPositionChange: (value: 'left' | 'main' | 'right') => void;
  terminalTheme: string;
  onTerminalThemeChange: (id: string) => void;
  preferredIDE: 'cursor' | 'code' | 'auto';
  onPreferredIDEChange: (value: 'cursor' | 'code' | 'auto') => void;
  commitAttribution: string | undefined;
  onCommitAttributionChange: (value: string | undefined) => void;
  activeProjectPath?: string;
  keybindings: KeyBindingMap;
  onKeybindingsChange: (bindings: KeyBindingMap) => void;
  pixelAgentsConfig: PixelAgentsConfig | null;
  onPixelAgentsConfigChange: (config: PixelAgentsConfig) => void;
  pixelAgentsStatus: PixelAgentsStatus;
  statusLineData: Record<string, StatusLineData>;
  taskNames: Record<string, string>;
  latestRateLimits?: RateLimits;
  usageThresholds: UsageThresholds;
  onUsageThresholdsChange: (thresholds: UsageThresholds) => void;
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

function getViewerUrl(wsUrl: string): string | null {
  const httpUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://') + '/office/';
  try {
    const parsed = new URL(httpUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function OfficeStatusDot({ status }: { status: PixelAgentsOfficeStatus | undefined }) {
  const color = {
    registered: 'bg-[hsl(var(--git-added))]',
    connected: 'bg-[hsl(var(--git-modified))]',
    disconnected: 'bg-[hsl(var(--git-deleted))]',
    unknown: 'bg-border',
  }[status || 'unknown'];

  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />;
}

function PixelAgentsSection({
  config,
  onChange,
  status,
}: {
  config: PixelAgentsConfig | null;
  onChange: (config: PixelAgentsConfig) => void;
  status: PixelAgentsStatus;
}) {
  const [addingOffice, setAddingOffice] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [localName, setLocalName] = useState(config?.name || '');
  const [localPhrases, setLocalPhrases] = useState(config?.phrases?.join(', ') || '');
  const [phrasesDirty, setPhrasesDirty] = useState(false);
  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveConfig = config || { name: '', offices: [] };

  // Sync local state when config changes externally
  useEffect(() => {
    setLocalName(config?.name || '');
  }, [config?.name]);

  useEffect(() => {
    setLocalPhrases(config?.phrases?.join(', ') || '');
  }, [config?.phrases]);

  function updateConfig(partial: Partial<PixelAgentsConfig>) {
    onChange({ ...effectiveConfig, ...partial });
  }

  function updateOffice(id: string, updates: Partial<PixelAgentsOffice>) {
    onChange({
      ...effectiveConfig,
      offices: effectiveConfig.offices.map((o) => (o.id === id ? { ...o, ...updates } : o)),
    });
  }

  function deleteOffice(id: string) {
    onChange({
      ...effectiveConfig,
      offices: effectiveConfig.offices.filter((o) => o.id !== id),
    });
  }

  function addOffice(office: PixelAgentsOffice) {
    onChange({
      ...effectiveConfig,
      offices: [...effectiveConfig.offices, office],
    });
    setAddingOffice(false);
  }

  function saveEditedOffice(office: PixelAgentsOffice) {
    updateOffice(office.id, office);
    setEditingId(null);
  }

  return (
    <div>
      {/* Description */}
      <div
        className="p-4 rounded-xl border border-border/40 mb-6"
        style={{ background: 'hsl(var(--surface-2))' }}
      >
        <p className="text-[12px] text-foreground/90 leading-relaxed">
          Pixel Agents streams your Claude Code activity to a shared pixel art office. Your agents
          appear as characters working at desks alongside your teammates.
        </p>
        <p className="text-[12px] text-foreground/90 leading-relaxed mt-2">
          Only tool activity metadata is sent (e.g. &quot;Reading&quot;, &quot;Editing&quot;,
          &quot;Running&quot;). No code, file paths, commands, or prompts ever leave your machine.
        </p>
        <p className="text-[12px] text-foreground/90 leading-relaxed mt-2">
          Connect to a remote server hosted by your team, or run one locally with{' '}
          <code className="px-1.5 py-0.5 rounded bg-accent/80 text-[10px] font-mono text-foreground/90">
            npx @pixel-agents/office-server --port 8080
          </code>{' '}
          and connect to{' '}
          <code className="px-1.5 py-0.5 rounded bg-accent/80 text-[10px] font-mono text-foreground/90">
            ws://localhost:8080
          </code>
          .
        </p>
      </div>

      {/* Display Name */}
      <div className="mb-3">
        <label className="block text-[11px] text-foreground/60 mb-1.5">Display Name</label>
        <input
          type="text"
          value={localName}
          onChange={(e) => {
            const val = e.target.value;
            setLocalName(val);
            if (nameTimerRef.current) clearTimeout(nameTimerRef.current);
            nameTimerRef.current = setTimeout(() => {
              updateConfig({ name: val });
            }, 500);
          }}
          placeholder="e.g. Alice"
          className="w-full px-3 py-2.5 rounded-lg text-[12px] border border-border/60 bg-transparent text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
        />
      </div>

      {/* Phrases */}
      <div className="mb-3">
        <label className="flex items-center gap-1.5 text-[11px] text-foreground/60 mb-1.5">
          Speech Bubble Phrases
          {phrasesDirty && <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400" />}
        </label>
        <input
          type="text"
          value={localPhrases}
          onChange={(e) => {
            setLocalPhrases(e.target.value);
            setPhrasesDirty(true);
          }}
          onBlur={() => {
            if (!phrasesDirty) return;
            const parsed = localPhrases
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => (s.length > 50 ? s.slice(0, 50) : s));
            updateConfig({ phrases: parsed });
            setPhrasesDirty(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="e.g. lgtm, shipping it!, need coffee"
          className="w-full px-3 py-2.5 rounded-lg text-[12px] border border-border/60 bg-transparent text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
        />
        <p className="text-[10px] text-foreground/40 mt-1">
          Comma-separated. Your agents will randomly say these in speech bubbles. Max 50 characters
          each.
        </p>
      </div>

      {/* Offices list */}
      {effectiveConfig.offices.length > 0 && (
        <div
          className="rounded-xl border border-border/40 overflow-hidden mb-3"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          {effectiveConfig.offices.map((office, i) =>
            editingId === office.id ? (
              <OfficeForm
                key={office.id}
                initial={office}
                onSave={saveEditedOffice}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div
                key={office.id}
                className={`flex items-center gap-3 px-4 py-3 ${
                  i < effectiveConfig.offices.length - 1 ? 'border-b border-border/20' : ''
                }`}
              >
                <OfficeStatusDot status={office.enabled ? status.offices[office.id] : undefined} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-foreground font-medium truncate">
                    {office.id}
                  </div>
                  <div className="text-[10px] text-foreground/40 font-mono truncate">
                    {office.url}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Tooltip content="Open in browser">
                    <button
                      onClick={() => {
                        const url = getViewerUrl(office.url);
                        if (url) window.electronAPI.openExternal(url);
                      }}
                      className="p-1.5 rounded-md text-foreground/30 hover:text-foreground hover:bg-accent/60 transition-all duration-150"
                    >
                      <ExternalLink size={12} strokeWidth={1.8} />
                    </button>
                  </Tooltip>
                  <Tooltip content="Edit">
                    <button
                      onClick={() => setEditingId(office.id)}
                      className="p-1.5 rounded-md text-foreground/30 hover:text-foreground hover:bg-accent/60 transition-all duration-150"
                    >
                      <Pencil size={12} strokeWidth={1.8} />
                    </button>
                  </Tooltip>
                  <Tooltip content="Delete">
                    <button
                      onClick={() => deleteOffice(office.id)}
                      className="p-1.5 rounded-md text-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-all duration-150"
                    >
                      <Trash2 size={12} strokeWidth={1.8} />
                    </button>
                  </Tooltip>
                  {/* Enable/disable toggle */}
                  <button
                    onClick={() => updateOffice(office.id, { enabled: !office.enabled })}
                    className="ml-1"
                  >
                    <div
                      className={`w-8 h-[18px] rounded-full relative transition-colors duration-150 flex-shrink-0 ${
                        office.enabled ? 'bg-primary' : 'bg-border'
                      }`}
                    >
                      <div
                        className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-150 ${
                          office.enabled ? 'translate-x-[16px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </div>
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {/* Add office form or button */}
      {addingOffice ? (
        <OfficeForm onSave={addOffice} onCancel={() => setAddingOffice(false)} />
      ) : (
        <button
          onClick={() => setAddingOffice(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] border border-dashed border-border/60 text-foreground/50 hover:text-foreground hover:border-border hover:bg-accent/30 transition-all duration-150 w-full justify-center"
        >
          <Plus size={12} strokeWidth={2} />
          Add Office
        </button>
      )}

      <p className="text-[10px] text-foreground/50 mt-2">
        Private servers require a token set via the WATCHER_TOKEN env var on the server.
      </p>
    </div>
  );
}

function OfficeForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: PixelAgentsOffice;
  onSave: (office: PixelAgentsOffice) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.id || '');
  const [url, setUrl] = useState(initial?.url || '');
  const [isPublic, setIsPublic] = useState(initial ? !initial.token : true);
  const [token, setToken] = useState(initial?.token || '');

  const isValid = name.trim() && url.trim() && (isPublic || token.trim());

  function handleSave() {
    if (!isValid) return;
    onSave({
      id: name.trim(),
      url: url.trim(),
      token: isPublic ? null : token.trim(),
      enabled: initial?.enabled ?? true,
    });
  }

  return (
    <div className="p-4 space-y-3 border border-border/40 rounded-xl bg-[hsl(var(--surface-2))]">
      <div>
        <label className="block text-[11px] text-foreground/60 mb-1.5">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Team Office"
          autoFocus
          className="w-full px-3 py-2.5 rounded-lg text-[12px] border border-border/60 bg-transparent text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
        />
      </div>
      <div>
        <label className="block text-[11px] text-foreground/60 mb-1.5">Server URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="wss://example.com"
          className="w-full px-3 py-2.5 rounded-lg text-[12px] font-mono border border-border/60 bg-transparent text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
        />
      </div>
      <div>
        <label className="block text-[11px] text-foreground/60 mb-1.5">Access</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setIsPublic(true)}
            className={`px-3 py-2.5 rounded-lg text-[12px] border transition-all duration-150 ${
              isPublic
                ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20 font-medium'
                : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
            }`}
          >
            Public
          </button>
          <button
            onClick={() => setIsPublic(false)}
            className={`px-3 py-2.5 rounded-lg text-[12px] border transition-all duration-150 ${
              !isPublic
                ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20 font-medium'
                : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
            }`}
          >
            Private
          </button>
        </div>
      </div>
      {!isPublic && (
        <div>
          <label className="block text-[11px] text-foreground/60 mb-1.5">Token</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Authentication token"
            className="w-full px-3 py-2.5 rounded-lg text-[12px] font-mono border border-border/60 bg-transparent text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
          />
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-2 rounded-lg text-[12px] border border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground transition-all duration-150"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!isValid}
          className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20 hover:bg-primary/15 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {initial ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  );
}

function ThresholdInput({
  label,
  value,
  onChange,
  suffix,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[12px] text-foreground/80">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          step={suffix === '$' ? 0.5 : 5}
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === '' ? null : Number(raw));
          }}
          placeholder={placeholder ?? 'Off'}
          className="w-[72px] px-2 py-1 rounded-md text-[12px] text-right tabular-nums bg-surface-2 border border-border/40 text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40"
          style={{ background: 'hsl(var(--surface-2))' }}
        />
        {suffix && <span className="text-[11px] text-foreground/40">{suffix}</span>}
      </div>
    </div>
  );
}

function UsageSection({
  statusLineData,
  taskNames,
  latestRateLimits,
  thresholds,
  onThresholdsChange,
}: {
  statusLineData: Record<string, StatusLineData>;
  taskNames: Record<string, string>;
  latestRateLimits?: RateLimits;
  thresholds: UsageThresholds;
  onThresholdsChange: (t: UsageThresholds) => void;
}) {
  const entries = Object.entries(statusLineData);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Account-wide rate limits */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/60">
            Your Usage
          </span>
          <div className="flex-1 h-px bg-border/30" />
        </div>

        {latestRateLimits ? (
          <div
            className="rounded-xl border border-border/40 p-4 space-y-3"
            style={{ background: 'hsl(var(--surface-2))' }}
          >
            {latestRateLimits.fiveHour && (
              <UsageBar
                label="5-hour rate limit"
                percentage={latestRateLimits.fiveHour.usedPercentage}
                detail={
                  latestRateLimits.fiveHour.resetsAt
                    ? `resets ${formatResetTime(latestRateLimits.fiveHour.resetsAt)}`
                    : undefined
                }
              />
            )}
            {latestRateLimits.sevenDay && (
              <UsageBar
                label="7-day rate limit"
                percentage={latestRateLimits.sevenDay.usedPercentage}
                detail={
                  latestRateLimits.sevenDay.resetsAt
                    ? `resets ${formatResetTime(latestRateLimits.sevenDay.resetsAt)}`
                    : undefined
                }
              />
            )}
          </div>
        ) : (
          <p className="text-[12px] text-foreground/40 py-4 text-center">
            Rate limit data appears after the first API response
          </p>
        )}
      </div>

      {/* Per-session context usage */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/60">
            Sessions
          </span>
          <div className="flex-1 h-px bg-border/30" />
        </div>

        {entries.length === 0 ? (
          <p className="text-[12px] text-foreground/40 py-4 text-center">No active sessions</p>
        ) : (
          <div className="space-y-3">
            {entries.map(([ptyId, sl]) => (
              <div
                key={ptyId}
                className="rounded-xl border border-border/40 p-4 space-y-3"
                style={{ background: 'hsl(var(--surface-2))' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-foreground/80 truncate">
                    {taskNames[ptyId] || 'Unknown task'}
                  </span>
                  <span className="text-[10px] text-foreground/40 flex-shrink-0">
                    {sl.model ?? 'Claude'}
                  </span>
                </div>

                <UsageBar
                  label="Context"
                  percentage={sl.contextUsage.percentage}
                  detail={`${formatTokens(sl.contextUsage.used)} / ${formatTokens(sl.contextUsage.total)}`}
                />

                {sl.cost && (
                  <div className="flex items-center gap-4 pt-1 text-[10px] text-foreground/40">
                    <span>API: {formatDuration(sl.cost.totalApiDurationMs)}</span>
                    <span>Wall: {formatDuration(sl.cost.totalDurationMs)}</span>
                    {(sl.cost.totalLinesAdded > 0 || sl.cost.totalLinesRemoved > 0) && (
                      <span>
                        <span className="text-emerald-400">+{sl.cost.totalLinesAdded}</span>
                        {' / '}
                        <span className="text-red-400">-{sl.cost.totalLinesRemoved}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Threshold Alerts */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/60">
            Threshold Alerts
          </span>
          <div className="flex-1 h-px bg-border/30" />
        </div>
        <p className="text-[11px] text-foreground/40 mb-3">
          Show a notification when usage exceeds a threshold. Leave empty to disable.
        </p>
        <div
          className="rounded-xl border border-border/40 px-4 divide-y divide-border/20"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <ThresholdInput
            label="Context window"
            value={thresholds.contextPercentage}
            onChange={(v) => onThresholdsChange({ ...thresholds, contextPercentage: v })}
            suffix="%"
            placeholder="80"
          />
          <ThresholdInput
            label="5-hour rate limit"
            value={thresholds.fiveHourPercentage}
            onChange={(v) => onThresholdsChange({ ...thresholds, fiveHourPercentage: v })}
            suffix="%"
            placeholder="Off"
          />
          <ThresholdInput
            label="7-day rate limit"
            value={thresholds.sevenDayPercentage}
            onChange={(v) => onThresholdsChange({ ...thresholds, sevenDayPercentage: v })}
            suffix="%"
            placeholder="Off"
          />
        </div>
      </div>
    </div>
  );
}

export function SettingsModal({
  initialTab,
  theme,
  onThemeChange,
  diffContextLines,
  onDiffContextLinesChange,
  notificationSound,
  onNotificationSoundChange,
  desktopNotification,
  onDesktopNotificationChange,
  shellDrawerEnabled,
  onShellDrawerEnabledChange,
  shellDrawerPosition,
  onShellDrawerPositionChange,
  terminalTheme,
  onTerminalThemeChange,
  preferredIDE,
  onPreferredIDEChange,
  commitAttribution,
  onCommitAttributionChange,
  activeProjectPath,
  keybindings,
  onKeybindingsChange,
  pixelAgentsConfig,
  onPixelAgentsConfigChange,
  pixelAgentsStatus,
  statusLineData,
  taskNames,
  latestRateLimits,
  usageThresholds,
  onUsageThresholdsChange,
  onClose,
}: SettingsModalProps) {
  const validTabs: SettingsTab[] = [
    'general',
    'appearance',
    'keybindings',
    'usage',
    'pixel-agents',
  ];
  const [tab, setTab] = useState<SettingsTab>(
    initialTab && validTabs.includes(initialTab as SettingsTab)
      ? (initialTab as SettingsTab)
      : 'general',
  );
  const [claudeInfo, setClaudeInfo] = useState<{
    installed: boolean;
    version: string | null;
    path: string | null;
  } | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [claudeDefaultAttribution, setClaudeDefaultAttribution] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'checking' | 'available' | 'downloading' | 'ready'
  >('idle');
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [telemetryEnabled, setTelemetryEnabled] = useState(true);
  const [telemetryEnvDisabled, setTelemetryEnvDisabled] = useState(false);

  useEffect(() => {
    const cleanups = [
      window.electronAPI.onAutoUpdateAvailable((info) => {
        setUpdateStatus('available');
        setUpdateVersion(info.version);
      }),
      window.electronAPI.onAutoUpdateNotAvailable(() => {
        setUpdateStatus('idle');
      }),
      window.electronAPI.onAutoUpdateDownloaded(() => {
        setUpdateStatus('ready');
      }),
      window.electronAPI.onAutoUpdateError(() => {
        setUpdateStatus((s) => (s === 'downloading' ? 'available' : 'idle'));
      }),
    ];
    return () => cleanups.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    window.electronAPI.detectClaude().then((resp) => {
      if (resp.success) setClaudeInfo(resp.data ?? null);
    });
    window.electronAPI.getAppVersion().then((v) => setAppVersion(v));
    window.electronAPI.telemetryGetStatus().then((resp) => {
      if (resp.success && resp.data) {
        setTelemetryEnabled(resp.data.enabled);
        setTelemetryEnvDisabled(resp.data.envDisabled);
      }
    });
    window.electronAPI.getClaudeAttribution(activeProjectPath).then((resp) => {
      if (resp.success && resp.data != null) {
        setClaudeDefaultAttribution(resp.data);
      }
    });
  }, [activeProjectPath]);

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
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[560px] h-[80vh] flex flex-col animate-slide-up overflow-hidden"
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
            className="p-1.5 rounded-lg hover:bg-accent text-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 px-5 border-b border-border/40">
          {(
            [
              { id: 'general', label: 'General' },
              { id: 'appearance', label: 'Appearance' },
              { id: 'keybindings', label: 'Keybindings' },
              { id: 'usage', label: 'Usage' },
              { id: 'pixel-agents', label: 'Pixel Agents' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2.5 text-[12px] font-medium border-b-2 transition-all duration-150 ${
                tab === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-foreground/50 hover:text-foreground/80'
              }`}
            >
              {t.label}
              {t.id === 'pixel-agents' && (
                <>
                  {Object.values(pixelAgentsStatus.offices).some(
                    (s) => s === 'connected' || s === 'registered',
                  ) && (
                    <span className="ml-1.5 w-2 h-2 rounded-full bg-[hsl(var(--git-added))] inline-block" />
                  )}
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-primary/15 text-primary leading-none">
                    Experimental
                  </span>
                </>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1">
          {tab === 'general' && (
            <div className="space-y-6 animate-fade-in">
              {/* Diff Context */}
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-3">
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
                            : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-foreground/80 mt-2">
                  Number of unchanged lines shown around each change
                </p>
              </div>

              {/* Notification Sound */}
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-3">
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
                            : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
                        }`}
                      >
                        {SOUND_LABELS[sound]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-foreground/80 mt-2">
                  Play a sound when a task finishes and needs attention
                </p>
              </div>

              {/* Desktop Notification */}
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-3">
                  Desktop Notifications
                </label>
                <button
                  onClick={() => onDesktopNotificationChange(!desktopNotification)}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg text-[13px] border transition-all duration-150 ${
                    desktopNotification
                      ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20'
                      : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
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
                  Show desktop notification when a task finishes
                </button>
                <p className="text-[10px] text-foreground/80 mt-2">
                  Notification will include the task name
                </p>
              </div>

              {/* Shell Terminal */}
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-3">
                  Shell Terminal
                </label>
                <button
                  onClick={() => onShellDrawerEnabledChange(!shellDrawerEnabled)}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg text-[13px] border transition-all duration-150 ${
                    shellDrawerEnabled
                      ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20'
                      : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
                  }`}
                >
                  <div
                    className={`w-8 h-[18px] rounded-full relative transition-colors duration-150 flex-shrink-0 ${
                      shellDrawerEnabled ? 'bg-primary' : 'bg-border'
                    }`}
                  >
                    <div
                      className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-150 ${
                        shellDrawerEnabled ? 'translate-x-[16px]' : 'translate-x-[2px]'
                      }`}
                    />
                  </div>
                  Show shell terminal drawer
                </button>
                {shellDrawerEnabled && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {[
                      { value: 'left' as const, label: 'Left Sidebar' },
                      { value: 'main' as const, label: 'Main Pane' },
                      { value: 'right' as const, label: 'Right Sidebar' },
                    ].map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => onShellDrawerPositionChange(value)}
                        className={`px-3 py-2.5 rounded-lg text-[12px] border transition-all duration-150 ${
                          shellDrawerPosition === value
                            ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20 font-medium'
                            : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-foreground/80 mt-2">
                  Toggle with Cmd+J. Run git, npm, and other commands alongside Claude.
                </p>
              </div>

              {/* Preferred IDE */}
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-3">
                  Preferred IDE
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { value: 'auto' as const, label: 'Auto-detect' },
                      { value: 'cursor' as const, label: 'Cursor' },
                      { value: 'code' as const, label: 'VS Code' },
                    ] as const
                  ).map(({ value, label }) => {
                    const isActive = preferredIDE === value;
                    return (
                      <button
                        key={value}
                        onClick={() => onPreferredIDEChange(value)}
                        className={`px-3 py-2.5 rounded-lg text-[12px] border transition-all duration-150 ${
                          isActive
                            ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20 font-medium'
                            : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-foreground/80 mt-2">
                  IDE used when opening a task from the header
                </p>
              </div>

              {/* Commit Attribution */}
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-3">
                  Commit Attribution
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: 'default' as const, label: 'Default' },
                      { value: 'custom' as const, label: 'Custom' },
                    ] as const
                  ).map(({ value, label }) => {
                    const isActive =
                      value === 'default'
                        ? commitAttribution === undefined
                        : commitAttribution !== undefined;
                    return (
                      <button
                        key={value}
                        onClick={() => {
                          if (value === 'default') {
                            onCommitAttributionChange(undefined);
                          } else {
                            onCommitAttributionChange(
                              commitAttribution ?? DASH_DEFAULT_ATTRIBUTION,
                            );
                          }
                        }}
                        className={`px-3 py-2.5 rounded-lg text-[12px] border transition-all duration-150 ${
                          isActive
                            ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20 font-medium'
                            : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  value={
                    commitAttribution === undefined
                      ? (claudeDefaultAttribution ?? DASH_DEFAULT_ATTRIBUTION)
                      : commitAttribution
                  }
                  onChange={(e) => onCommitAttributionChange(e.target.value)}
                  readOnly={commitAttribution === undefined}
                  rows={3}
                  className={`mt-3 w-full px-3 py-2.5 rounded-lg text-[12px] font-mono border bg-transparent resize-none ${
                    commitAttribution === undefined
                      ? 'border-border/40 text-foreground/40 cursor-default'
                      : 'border-border/60 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40'
                  }`}
                />
                <p className="text-[10px] text-foreground/80 mt-2">
                  Controls attribution appended to git commits by Claude. Default uses the Dash
                  attribution. Clear the field to disable attribution.
                </p>
              </div>

              {/* Claude CLI */}
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-3">
                  Claude Code CLI
                </label>
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
                    {claudeInfo?.installed ? (
                      <div className="space-y-0.5">
                        <p className="text-[11px] text-foreground/60 font-mono">
                          {claudeInfo.version}
                        </p>
                        <p className="text-[11px] text-foreground/40 font-mono truncate">
                          {claudeInfo.path}
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-foreground/60 leading-relaxed">
                        Not found. Install with{' '}
                        <code className="px-1.5 py-0.5 rounded bg-accent/80 text-[10px] font-mono text-foreground/70">
                          npm install -g @anthropic-ai/claude-code
                        </code>
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Updates */}
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-3">
                  Updates
                </label>
                <div className="flex items-center gap-3">
                  <p className="text-[13px] text-foreground/80 font-mono">{appVersion || '...'}</p>
                  {updateStatus === 'ready' ? (
                    <button
                      onClick={() => window.electronAPI.autoUpdateQuitAndInstall()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20 hover:bg-primary/15 transition-all duration-150"
                    >
                      <Download size={12} strokeWidth={2} />
                      Restart to Update {updateVersion && `(v${updateVersion})`}
                    </button>
                  ) : updateStatus === 'available' ? (
                    <button
                      onClick={() => {
                        setUpdateStatus('downloading');
                        window.electronAPI.autoUpdateDownload();
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20 hover:bg-primary/15 transition-all duration-150"
                    >
                      <Download size={12} strokeWidth={2} />
                      Download v{updateVersion}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setUpdateStatus('checking');
                        window.electronAPI.autoUpdateCheck().then((resp) => {
                          if (!resp.success) {
                            setUpdateStatus('idle');
                          }
                          // Event listeners (notAvailable/available) will update status
                        });
                      }}
                      disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                      className="px-3 py-1.5 rounded-lg text-[12px] border border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground transition-all duration-150 disabled:opacity-50"
                    >
                      {updateStatus === 'checking'
                        ? 'Checking...'
                        : updateStatus === 'downloading'
                          ? 'Downloading...'
                          : 'Check for Updates'}
                    </button>
                  )}
                </div>
              </div>

              {/* Privacy & Telemetry */}
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-3">
                  Privacy & Telemetry
                </label>
                <div className="space-y-2">
                  <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/60 hover:bg-accent/30 transition-colors cursor-pointer">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-foreground">Send anonymous usage data</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Helps us understand how Dash is used so we can improve it.
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        <span className="font-medium text-foreground/70">What we collect:</span> app
                        start/close, session duration, daily active usage, project and task counts
                        (created, deleted, archived), worktree and terminal usage, app version,
                        platform, and architecture.
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        <span className="font-medium text-foreground/70">
                          What we never collect:
                        </span>{' '}
                        no code, file paths, prompts, IP addresses, device identifiers, MAC
                        addresses, or any personal information.
                      </p>
                      {telemetryEnvDisabled && (
                        <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                          <AlertCircle size={11} strokeWidth={2} />
                          Disabled via TELEMETRY_ENABLED env var
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={telemetryEnabled && !telemetryEnvDisabled}
                      disabled={telemetryEnvDisabled}
                      onClick={() => {
                        const next = !telemetryEnabled;
                        setTelemetryEnabled(next);
                        window.electronAPI.telemetrySetEnabled(next);
                      }}
                      className={`relative inline-flex h-[20px] w-[36px] shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                        telemetryEnabled && !telemetryEnvDisabled ? 'bg-primary' : 'bg-border/60'
                      } ${telemetryEnvDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-[16px] w-[16px] rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
                          telemetryEnabled && !telemetryEnvDisabled
                            ? 'translate-x-[16px]'
                            : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </div>
            </div>
          )}

          {tab === 'appearance' && (
            <div className="space-y-6 animate-fade-in">
              {/* App Theme */}
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-3">
                  App Theme
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onThemeChange('light')}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-lg text-[13px] border transition-all duration-150 ${
                      theme === 'light'
                        ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20'
                        : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
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
                        : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
                    }`}
                  >
                    <Moon size={15} strokeWidth={1.8} />
                    Dark
                  </button>
                </div>
              </div>

              {/* Terminal Theme */}
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-3">
                  Terminal Theme
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {TERMINAL_THEMES.map((t) => {
                    const isActive = terminalTheme === t.id;
                    const bg =
                      t.id === 'default'
                        ? theme === 'dark'
                          ? '#1f1f1f'
                          : '#fafafa'
                        : t.theme.background || '#000';
                    const colors = [
                      t.theme.red || '#f00',
                      t.theme.green || '#0f0',
                      t.theme.blue || '#00f',
                      t.theme.yellow || '#ff0',
                      t.theme.magenta || '#f0f',
                      t.theme.cyan || '#0ff',
                    ];
                    return (
                      <button
                        key={t.id}
                        onClick={() => onTerminalThemeChange(t.id)}
                        className={`flex flex-col gap-1.5 p-2.5 rounded-lg border transition-all duration-150 ${
                          isActive
                            ? 'border-primary/40 ring-1 ring-primary/20'
                            : 'border-border/60 hover:border-border'
                        }`}
                      >
                        <div
                          className="w-full h-6 rounded flex items-center gap-[3px] px-1.5"
                          style={{ background: bg }}
                        >
                          {colors.map((c, i) => (
                            <div
                              key={i}
                              className="w-2 h-2 rounded-full"
                              style={{ background: c }}
                            />
                          ))}
                        </div>
                        <span className="text-[10px] font-medium truncate w-full text-left">
                          {t.name}
                          {t.id === 'default' && (
                            <span className="text-foreground/40"> (auto)</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-foreground/80 mt-2">
                  Applies to both Claude and shell terminals
                </p>
              </div>
            </div>
          )}

          {tab === 'pixel-agents' && (
            <div className="space-y-6 animate-fade-in">
              <PixelAgentsSection
                config={pixelAgentsConfig}
                onChange={onPixelAgentsConfigChange}
                status={pixelAgentsStatus}
              />
            </div>
          )}

          {tab === 'usage' && (
            <UsageSection
              statusLineData={statusLineData}
              taskNames={taskNames}
              latestRateLimits={latestRateLimits}
              thresholds={usageThresholds}
              onThresholdsChange={onUsageThresholdsChange}
            />
          )}

          {tab === 'keybindings' && (
            <div className="space-y-5 animate-fade-in">
              {/* Header row */}
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-foreground/60">
                  Click a shortcut to record a new binding
                </p>
                <button
                  onClick={handleResetAll}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-foreground/60 hover:text-foreground hover:bg-accent/60 transition-all duration-150"
                >
                  <RotateCcw size={10} strokeWidth={2} />
                  Reset all
                </button>
              </div>

              {/* Grouped bindings */}
              {groups.map((group) => (
                <div key={group.category}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/60">
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
                              <Tooltip content="Reset to default">
                                <button
                                  onClick={() => handleResetOne(binding.id)}
                                  className="p-1.5 rounded-md text-foreground/30 hover:text-foreground hover:bg-accent/60 opacity-0 group-hover:opacity-100 transition-all duration-150"
                                >
                                  <RotateCcw size={11} strokeWidth={2} />
                                </button>
                              </Tooltip>
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
        </div>
      </div>
    </div>
  );
}
