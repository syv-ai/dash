import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { toast } from 'sonner';
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
  HelpCircle,
  FolderOpen,
  Palette,
  Code2,
  Bell,
  Sparkles,
  Keyboard,
  Activity,
  Puzzle,
  Info,
  ChevronDown,
  PanelLeft,
  GitCompare,
  Terminal as TerminalIcon,
  GitCommit,
  Shield,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './ui/Tooltip';
import { ToggleSwitch } from './ui/ToggleSwitch';
import { Switch } from './ui/Switch';
import type { KeyBindingMap, KeyBinding } from '../keybindings';
import {
  getBindingKeys,
  bindingFromEvent,
  DEFAULT_KEYBINDINGS,
  groupByCategory,
} from '../keybindings';
import { NOTIFICATION_SOUNDS, SOUND_LABELS } from '../sounds';
import type { NotificationSound } from '../sounds';
import { TERMINAL_THEMES, darkTheme, lightTheme } from '../terminal/terminalThemes';
import { TERMINAL_FONTS, resolveTerminalFontValue } from '../terminal/terminalFonts';
import { Select } from './ui/Select';
import type {
  RateLimits,
  UsageThresholds,
  RtkStatus,
  RtkDownloadProgress,
  RtkTestResult,
} from '../../shared/types';
import { formatResetTime } from '../../shared/format';
import { UsageBar } from './ui/UsageBar';

const DASH_DEFAULT_ATTRIBUTION =
  '\n\nCo-Authored-By: Claude <noreply@anthropic.com> via Dash <dash@syv.ai>';

type SettingsTab =
  | 'sidebar'
  | 'appearance'
  | 'notifications'
  | 'diff'
  | 'terminal'
  | 'ide'
  | 'attribution'
  | 'claude-code'
  | 'keybindings'
  | 'usage'
  | 'add-ons'
  | 'updates'
  | 'privacy'
  | 'about';

const NAV_GROUPS: Array<{ label: string; ids: SettingsTab[] }> = [
  { label: 'Interface', ids: ['sidebar', 'appearance', 'notifications'] },
  { label: 'Editor', ids: ['diff', 'terminal', 'ide'] },
  { label: 'Workflow', ids: ['attribution', 'claude-code', 'keybindings', 'usage'] },
  { label: 'System', ids: ['add-ons', 'updates', 'privacy', 'about'] },
];

const NAV_ITEMS: Array<{
  id: SettingsTab;
  label: string;
  description: string;
  Icon: LucideIcon;
}> = [
  {
    id: 'sidebar',
    label: 'Sidebar',
    description: 'What appears in the left sidebar.',
    Icon: PanelLeft,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'App theme and terminal palette.',
    Icon: Palette,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Sound and desktop alerts when tasks need attention.',
    Icon: Bell,
  },
  {
    id: 'diff',
    label: 'Diff',
    description: 'How file diffs are displayed.',
    Icon: GitCompare,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'The shell drawer that runs alongside Claude.',
    Icon: TerminalIcon,
  },
  {
    id: 'ide',
    label: 'IDE',
    description: 'External editor used when opening tasks.',
    Icon: Code2,
  },
  {
    id: 'attribution',
    label: 'Attribution',
    description: 'How commits made by Claude are signed.',
    Icon: GitCommit,
  },
  {
    id: 'claude-code',
    label: 'Claude',
    description: 'CLI status, effort level, and environment.',
    Icon: Sparkles,
  },
  {
    id: 'keybindings',
    label: 'Keybindings',
    description: 'Customise keyboard shortcuts.',
    Icon: Keyboard,
  },
  {
    id: 'usage',
    label: 'Usage',
    description: 'Rate limits, context display, and threshold alerts.',
    Icon: Activity,
  },
  {
    id: 'add-ons',
    label: 'Add-ons',
    description: 'Optional integrations like RTK.',
    Icon: Puzzle,
  },
  {
    id: 'updates',
    label: 'Updates',
    description: 'Automatic update behavior and manual checks.',
    Icon: Download,
  },
  {
    id: 'privacy',
    label: 'Privacy',
    description: 'What anonymous data Dash sends home.',
    Icon: Shield,
  },
  {
    id: 'about',
    label: 'About',
    description: 'Version and credits.',
    Icon: Info,
  },
];

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
  autoUpdateEnabled: boolean;
  onAutoUpdateEnabledChange: (value: boolean) => void;
  updateNotificationsEnabled: boolean;
  onUpdateNotificationsEnabledChange: (value: boolean) => void;
  showRateLimits: boolean;
  onShowRateLimitsChange: (value: boolean) => void;
  showUsageInline: boolean;
  onShowUsageInlineChange: (value: boolean) => void;
  showContextUsageOnTaskCards: boolean;
  onShowContextUsageOnTaskCardsChange: (value: boolean) => void;
  showActiveTasksSection: boolean;
  onShowActiveTasksSectionChange: (value: boolean) => void;
  shellDrawerEnabled: boolean;
  onShellDrawerEnabledChange: (value: boolean) => void;
  shellDrawerPosition: 'main' | 'right';
  onShellDrawerPositionChange: (value: 'main' | 'right') => void;
  terminalTheme: string;
  onTerminalThemeChange: (id: string) => void;
  terminalFontFamily: string;
  onTerminalFontFamilyChange: (id: string) => void;
  preferredIDE: string;
  onPreferredIDEChange: (value: string) => void;
  availableIDEs: Array<{ id: string; label: string }>;
  customIDE: { path: string; args: string[] };
  onCustomIDEChange: (value: { path: string; args: string[] }) => void;
  commitAttribution: string | undefined;
  onCommitAttributionChange: (value: string | undefined) => void;
  effortLevel: string;
  onEffortLevelChange: (value: string) => void;
  syncShellEnv: boolean;
  onSyncShellEnvChange: (value: boolean) => void;
  customClaudeEnvVars: Record<string, string>;
  onCustomClaudeEnvVarsChange: (value: Record<string, string>) => void;
  activeProjectPath?: string;
  keybindings: KeyBindingMap;
  onKeybindingsChange: (bindings: KeyBindingMap) => void;
  rtkStatus: RtkStatus | null;
  onRtkEnabledChange: (enabled: boolean) => void;
  onRtkDownload: () => void;
  rtkDownloadProgress: RtkDownloadProgress | null;
  latestRateLimits?: RateLimits;
  usageThresholds: UsageThresholds;
  onUsageThresholdsChange: (thresholds: UsageThresholds) => void;
  onClose: () => void;
}

// ── Shared settings primitives ──────────────────────────────

function SettingsPane({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5 animate-fade-in">{children}</div>;
}

function SettingsCard({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      {(title || hint) && (
        <header className="mb-2 px-1 flex items-baseline justify-between gap-3">
          {title && (
            <h4 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-foreground/55">
              {title}
            </h4>
          )}
          {hint && <span className="text-[10.5px] text-foreground/40 leading-none">{hint}</span>}
        </header>
      )}
      <div
        className="rounded-xl border border-border/40 divide-y divide-border/20 overflow-hidden"
        style={{ background: 'hsl(var(--surface-2))' }}
      >
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  tooltip,
  control,
  align = 'center',
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  tooltip?: string;
  control?: React.ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div className={`flex gap-4 px-4 py-3 ${align === 'start' ? 'items-start' : 'items-center'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] text-foreground leading-snug">{label}</span>
          {tooltip && (
            <Tooltip content={tooltip}>
              <span className="inline-flex cursor-help text-foreground/40 hover:text-foreground/70">
                <HelpCircle size={12} strokeWidth={1.8} />
              </span>
            </Tooltip>
          )}
        </div>
        {description && (
          <div className="text-[11px] text-foreground/45 mt-1 leading-relaxed">{description}</div>
        )}
      </div>
      {control !== undefined && <div className="flex-shrink-0">{control}</div>}
    </div>
  );
}

function SettingsBlock({
  label,
  description,
  children,
}: {
  label?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 space-y-2">
      {label && <span className="block text-[12.5px] text-foreground leading-snug">{label}</span>}
      <div>{children}</div>
      {description && (
        <div className="text-[11px] text-foreground/45 leading-relaxed">{description}</div>
      )}
    </div>
  );
}

function Segmented<T extends string | number | null>({
  value,
  options,
  onChange,
  fullWidth = true,
  size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  onChange: (v: T) => void;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
}) {
  const activeIdx = options.findIndex((o) => o.value === value);
  const pad = size === 'sm' ? 'py-[5px] text-[11px]' : 'py-[7px] text-[12px]';
  const slot = 100 / options.length;
  return (
    <div
      className={`relative ${fullWidth ? 'flex w-full' : 'inline-flex'} p-[3px] rounded-lg border border-border/50`}
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      {activeIdx >= 0 && (
        <span
          aria-hidden
          className="absolute top-[3px] bottom-[3px] rounded-md transition-all duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] shadow-[0_1px_2px_hsl(0_0%_0%/0.18),inset_0_1px_0_hsl(0_0%_100%/0.06)]"
          style={{
            background: 'hsl(var(--surface-3))',
            border: '1px solid hsl(var(--primary) / 0.28)',
            left: `calc(${slot * activeIdx}% + 3px)`,
            width: `calc(${slot}% - 6px)`,
          }}
        />
      )}
      {options.map((opt, i) => {
        const active = i === activeIdx;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`relative z-10 flex items-center justify-center gap-1.5 px-3 ${pad} ${fullWidth ? 'flex-1' : ''} rounded-md font-medium transition-colors duration-150 ${
              active ? 'text-foreground' : 'text-foreground/55 hover:text-foreground/80'
            }`}
          >
            {opt.icon}
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function KeyCap({ label, highlighted = false }: { label: string; highlighted?: boolean }) {
  return (
    <kbd
      className={`inline-flex items-center justify-center min-w-[24px] h-[24px] px-1.5 rounded-[5px] text-[11px] font-medium leading-none font-mono transition-colors duration-150 ${
        highlighted
          ? 'border border-primary/45 bg-primary/12 text-foreground shadow-[0_1px_0_1px_hsl(var(--primary)/0.18),inset_0_1px_0_hsl(var(--primary)/0.12)]'
          : 'border border-border/80 bg-gradient-to-b from-white/[0.06] to-transparent text-foreground/80 shadow-[0_1px_0_1px_hsl(var(--border)/0.4),inset_0_1px_0_hsl(var(--foreground)/0.04)]'
      }`}
    >
      {label}
    </kbd>
  );
}

function KeyCombo({ keys, highlighted = false }: { keys: string[]; highlighted?: boolean }) {
  return (
    <div className="flex items-center gap-[3px]">
      {keys.map((k, i) => (
        <KeyCap key={i} label={k} highlighted={highlighted} />
      ))}
    </div>
  );
}

function KeyRecorder({
  binding,
  onChange,
  modified = false,
}: {
  binding: KeyBinding;
  onChange: (b: KeyBinding) => void;
  modified?: boolean;
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
        <KeyCombo keys={keys} highlighted={modified} />
      )}
    </button>
  );
}

function UsageSection({
  latestRateLimits,
  thresholds,
  onThresholdsChange,
  showRateLimits,
  onShowRateLimitsChange,
  showUsageInline,
  onShowUsageInlineChange,
  showContextUsageOnTaskCards,
  onShowContextUsageOnTaskCardsChange,
}: {
  latestRateLimits?: RateLimits;
  thresholds: UsageThresholds;
  onThresholdsChange: (t: UsageThresholds) => void;
  showRateLimits: boolean;
  onShowRateLimitsChange: (value: boolean) => void;
  showUsageInline: boolean;
  onShowUsageInlineChange: (value: boolean) => void;
  showContextUsageOnTaskCards: boolean;
  onShowContextUsageOnTaskCardsChange: (value: boolean) => void;
}) {
  return (
    <SettingsPane>
      <SettingsCard title="Your usage">
        {latestRateLimits && (latestRateLimits.fiveHour || latestRateLimits.sevenDay) ? (
          <div className="p-4 space-y-3">
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
          <p className="text-[11.5px] text-foreground/40 py-6 text-center">
            Rate-limit data appears after the first API response.
          </p>
        )}
      </SettingsCard>

      <SettingsCard title="Display">
        <SettingsRow
          label="Show rate limits"
          description="5-hour and 7-day account bars in the right sidebar."
          control={<Switch enabled={showRateLimits} onToggle={onShowRateLimitsChange} />}
        />
        <SettingsRow
          label="Show context usage"
          description="Current session's context-window bar in the right sidebar."
          control={<Switch enabled={showUsageInline} onToggle={onShowUsageInlineChange} />}
        />
        <SettingsRow
          label="Context bar on task cards"
          description="Thin progress bar beneath each task in the left sidebar."
          control={
            <Switch
              enabled={showContextUsageOnTaskCards}
              onToggle={onShowContextUsageOnTaskCardsChange}
            />
          }
        />
      </SettingsCard>

      <SettingsCard title="Threshold alerts" hint="Leave blank to disable">
        <SettingsRow
          label="Context window"
          control={
            <ThresholdInputInline
              value={thresholds.contextPercentage}
              onChange={(v) => onThresholdsChange({ ...thresholds, contextPercentage: v })}
              placeholder="80"
            />
          }
        />
        <SettingsRow
          label="5-hour rate limit"
          control={
            <ThresholdInputInline
              value={thresholds.fiveHourPercentage}
              onChange={(v) => onThresholdsChange({ ...thresholds, fiveHourPercentage: v })}
              placeholder="Off"
            />
          }
        />
        <SettingsRow
          label="7-day rate limit"
          control={
            <ThresholdInputInline
              value={thresholds.sevenDayPercentage}
              onChange={(v) => onThresholdsChange({ ...thresholds, sevenDayPercentage: v })}
              placeholder="Off"
            />
          }
        />
      </SettingsCard>
    </SettingsPane>
  );
}

function ThresholdInputInline({
  value,
  onChange,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        max={100}
        step={5}
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          const n = Number(raw);
          onChange(raw === '' || !Number.isFinite(n) || n < 0 ? null : Math.min(100, n));
        }}
        placeholder={placeholder ?? 'Off'}
        className="w-[80px] px-3 py-1.5 rounded-md text-[12px] text-right tabular-nums border border-border/60 bg-transparent text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="text-[11px] text-foreground/40">%</span>
    </div>
  );
}

function ClaudeCodeTab({
  effortLevel,
  onEffortLevelChange,
  syncShellEnv,
  onSyncShellEnvChange,
  customEnvVars,
  onCustomEnvVarsChange,
  claudeInfo,
}: {
  effortLevel: string;
  onEffortLevelChange: (v: string) => void;
  syncShellEnv: boolean;
  onSyncShellEnvChange: (v: boolean) => void;
  customEnvVars: Record<string, string>;
  onCustomEnvVarsChange: (v: Record<string, string>) => void;
  claudeInfo: { installed: boolean; version: string | null; path: string | null } | null;
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const entries = Object.entries(customEnvVars);

  function addEntry() {
    const key = newKey.trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    onCustomEnvVarsChange({ ...customEnvVars, [key]: newValue });
    setNewKey('');
    setNewValue('');
  }

  function removeEntry(key: string) {
    const next = { ...customEnvVars };
    delete next[key];
    onCustomEnvVarsChange(next);
  }

  return (
    <SettingsPane>
      {/* CLI Status */}
      <div
        className="flex items-start gap-3.5 p-4 rounded-xl border border-border/40"
        style={{ background: 'hsl(var(--surface-2))' }}
      >
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
            claudeInfo?.installed
              ? 'bg-[hsl(var(--git-added)/0.12)] ring-1 ring-[hsl(var(--git-added))/0.25]'
              : 'bg-[hsl(var(--git-modified)/0.12)] ring-1 ring-[hsl(var(--git-modified))/0.25]'
          }`}
        >
          {claudeInfo?.installed ? (
            <Check size={15} className="text-[hsl(var(--git-added))]" strokeWidth={1.8} />
          ) : (
            <AlertCircle size={15} className="text-[hsl(var(--git-modified))]" strokeWidth={1.8} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {claudeInfo?.installed ? (
            <>
              <p className="text-[12.5px] font-medium text-foreground">Claude Code detected</p>
              <p className="text-[11px] text-foreground/55 font-mono mt-1">{claudeInfo.version}</p>
              <p className="text-[10.5px] text-foreground/40 font-mono truncate">
                {claudeInfo.path}
              </p>
            </>
          ) : (
            <>
              <p className="text-[12.5px] font-medium text-foreground">CLI not found</p>
              <p className="text-[11px] text-foreground/55 leading-relaxed mt-1">
                Install with{' '}
                <code className="px-1.5 py-0.5 rounded bg-accent/80 text-[10px] font-mono text-foreground/75">
                  npm install -g @anthropic-ai/claude-code
                </code>
              </p>
            </>
          )}
        </div>
      </div>

      <SettingsCard title="Behavior">
        <SettingsRow
          label="Effort level"
          description="How much effort Claude spends reasoning. Auto lets the model decide."
          align="start"
          control={
            <Segmented
              fullWidth={false}
              size="sm"
              value={effortLevel}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Med' },
                { value: 'high', label: 'High' },
              ]}
              onChange={onEffortLevelChange}
            />
          }
        />
        <SettingsRow
          label="Inherit shell environment"
          description={
            syncShellEnv
              ? 'Claude inherits all env vars from Dash. Variables below override.'
              : 'Minimal isolated env. Only variables below are passed to Claude.'
          }
          control={<Switch enabled={syncShellEnv} onToggle={onSyncShellEnvChange} />}
        />
      </SettingsCard>

      <SettingsCard
        title="Environment variables"
        hint={
          <a
            href="https://code.claude.com/docs/en/env-vars"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline normal-case tracking-normal text-[10.5px]"
          >
            Reference
            <ExternalLink size={9} strokeWidth={1.8} />
          </a>
        }
      >
        <SettingsBlock description="Passed to Claude processes. Takes effect on new tasks.">
          <div className="space-y-1.5">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md text-[11.5px] font-mono border border-border/40 bg-[hsl(var(--surface-1))] text-foreground/85 truncate">
                  {key}
                </span>
                <span className="text-foreground/30 text-[12px]">=</span>
                <span className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md text-[11.5px] font-mono border border-border/40 bg-[hsl(var(--surface-1))] text-foreground/85 truncate">
                  {value}
                </span>
                <button
                  onClick={() => removeEntry(key)}
                  className="p-1.5 rounded-md hover:bg-destructive/10 text-foreground/40 hover:text-destructive transition-all duration-150 flex-shrink-0"
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addEntry();
                }}
                placeholder="VARIABLE_NAME"
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md text-[11.5px] font-mono border border-border/60 bg-transparent text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
              />
              <span className="text-foreground/30 text-[12px]">=</span>
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addEntry();
                }}
                placeholder="value"
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md text-[11.5px] font-mono border border-border/60 bg-transparent text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
              />
              <button
                onClick={addEntry}
                disabled={!newKey.trim()}
                className="p-1.5 rounded-md hover:bg-primary/10 text-foreground/40 hover:text-primary transition-all duration-150 flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Plus size={13} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        </SettingsBlock>
      </SettingsCard>
    </SettingsPane>
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
  autoUpdateEnabled,
  onAutoUpdateEnabledChange,
  updateNotificationsEnabled,
  onUpdateNotificationsEnabledChange,
  showRateLimits,
  onShowRateLimitsChange,
  showUsageInline,
  onShowUsageInlineChange,
  showContextUsageOnTaskCards,
  onShowContextUsageOnTaskCardsChange,
  showActiveTasksSection,
  onShowActiveTasksSectionChange,
  shellDrawerEnabled,
  onShellDrawerEnabledChange,
  shellDrawerPosition,
  onShellDrawerPositionChange,
  terminalTheme,
  onTerminalThemeChange,
  terminalFontFamily,
  onTerminalFontFamilyChange,
  preferredIDE,
  onPreferredIDEChange,
  availableIDEs,
  customIDE,
  onCustomIDEChange,
  commitAttribution,
  onCommitAttributionChange,
  effortLevel,
  onEffortLevelChange,
  syncShellEnv,
  onSyncShellEnvChange,
  customClaudeEnvVars,
  onCustomClaudeEnvVarsChange,
  activeProjectPath,
  keybindings,
  onKeybindingsChange,
  rtkStatus,
  onRtkEnabledChange,
  onRtkDownload,
  rtkDownloadProgress,
  latestRateLimits,
  usageThresholds,
  onUsageThresholdsChange,
  onClose,
}: SettingsModalProps) {
  const validTabs: SettingsTab[] = NAV_ITEMS.map((n) => n.id);
  const [tab, setTab] = useState<SettingsTab>(
    initialTab && validTabs.includes(initialTab as SettingsTab)
      ? (initialTab as SettingsTab)
      : 'sidebar',
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
  const activeNav = NAV_ITEMS.find((n) => n.id === tab) ?? NAV_ITEMS[0];
  const updateAvailable = updateStatus === 'available' || updateStatus === 'ready';

  // Sliding sidebar highlight refs
  const navContainerRef = useRef<HTMLDivElement>(null);
  const navItemRefs = useRef<Map<SettingsTab, HTMLButtonElement>>(new Map());
  const [navHighlight, setNavHighlight] = useState<{ top: number; height: number } | null>(null);
  const navHasAnimated = useRef(false);

  useLayoutEffect(() => {
    if (!navContainerRef.current) return;
    const btn = navItemRefs.current.get(tab);
    if (!btn) return;
    // offsetTop is immune to CSS transforms (the modal's slide-up animation)
    // and walks up to the nearest positioned ancestor — the nav container.
    setNavHighlight({
      top: btn.offsetTop,
      height: btn.offsetHeight,
    });
    if (!navHasAnimated.current) {
      requestAnimationFrame(() => {
        navHasAnimated.current = true;
      });
    }
  }, [tab]);

  // ESC closes the modal (capture phase, so it wins over xterm/pty listeners)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[1040px] max-w-[94vw] h-[86vh] max-h-[820px] flex flex-col animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar + Content */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar */}
          <nav
            className="sidebar-shell w-[224px] flex-shrink-0 flex flex-col border-r border-border/40"
            aria-label="Settings sections"
          >
            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-foreground tracking-tight">Settings</h2>
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-accent text-foreground/50 hover:text-foreground transition-all duration-150"
                aria-label="Close settings"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>

            <div ref={navContainerRef} className="flex-1 overflow-y-auto px-2 pb-3 relative">
              {/* Sliding highlight pill — sits OUTSIDE the space-y wrapper so it doesn't
                  add a margin to the first group when it mounts. */}
              {navHighlight && (
                <div
                  className="sidebar-pill-active absolute left-2 right-2 rounded-lg pointer-events-none"
                  style={{
                    top: navHighlight.top,
                    height: navHighlight.height,
                    transition: navHasAnimated.current
                      ? 'top 220ms cubic-bezier(0.16, 1, 0.3, 1), height 220ms cubic-bezier(0.16, 1, 0.3, 1)'
                      : 'none',
                  }}
                />
              )}
              <div className="space-y-4">
                {NAV_GROUPS.map((group) => (
                  <div key={group.label}>
                    <div className="px-3 pt-2 pb-1.5">
                      <span className="text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground/70 select-none">
                        {group.label}
                      </span>
                    </div>
                    <ul className="space-y-[2px]">
                      {group.ids.map((id) => {
                        const item = NAV_ITEMS.find((n) => n.id === id);
                        if (!item) return null;
                        const active = tab === item.id;
                        const showDot = item.id === 'about' && updateAvailable;
                        return (
                          <li key={item.id}>
                            <button
                              ref={(el) => {
                                if (el) navItemRefs.current.set(item.id, el);
                                else navItemRefs.current.delete(item.id);
                              }}
                              onClick={() => setTab(item.id)}
                              className={`group relative w-full flex items-center gap-2.5 pl-3 pr-2.5 py-[7px] rounded-lg text-[12.5px] transition-colors duration-150 ${
                                active
                                  ? 'text-foreground font-medium'
                                  : 'text-muted-foreground hover:text-foreground sidebar-row-hover'
                              }`}
                            >
                              <item.Icon
                                size={13}
                                strokeWidth={1.8}
                                className={`flex-shrink-0 transition-colors duration-150 ${
                                  active
                                    ? 'text-primary'
                                    : 'text-muted-foreground/70 group-hover:text-foreground/80'
                                }`}
                              />
                              <span className="flex-1 text-left truncate">{item.label}</span>
                              {showDot && (
                                <span className="w-[6px] h-[6px] rounded-full bg-[hsl(var(--git-added))] shadow-[0_0_6px_hsl(var(--git-added)/0.6)] flex-shrink-0" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-border/30 flex items-center justify-between">
              <span className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground/45">
                Dash
              </span>
              <span className="text-[10px] font-mono text-muted-foreground/55">
                {appVersion ? `v${appVersion}` : '…'}
              </span>
            </div>
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="overflow-y-auto flex-1">
              <div className="px-8 py-7">
                {/* Section header */}
                <div className="mb-6 animate-fade-in" key={`hdr-${tab}`}>
                  <h3 className="text-[19px] font-semibold text-foreground tracking-tight leading-tight">
                    {activeNav.label}
                  </h3>
                  <p className="text-[12.5px] text-foreground/50 mt-1.5 leading-relaxed">
                    {activeNav.description}
                  </p>
                </div>

                {tab === 'sidebar' && (
                  <SettingsPane key={`pane-${tab}`}>
                    <SettingsCard title="Active tasks">
                      <SettingsRow
                        label="Show active tasks"
                        description="Quick-switch between running tasks with Ctrl+Tab."
                        control={
                          <Switch
                            enabled={showActiveTasksSection}
                            onToggle={onShowActiveTasksSectionChange}
                          />
                        }
                      />
                    </SettingsCard>
                  </SettingsPane>
                )}

                {tab === 'attribution' && (
                  <SettingsPane key={`pane-${tab}`}>
                    <SettingsCard title="Commit attribution">
                      <SettingsRow
                        label="Mode"
                        description="Appended to git commits Claude makes on your behalf."
                        align="start"
                        control={
                          <Segmented
                            fullWidth={false}
                            size="sm"
                            value={commitAttribution === undefined ? 'default' : 'custom'}
                            options={[
                              { value: 'default', label: 'Default' },
                              { value: 'custom', label: 'Custom' },
                            ]}
                            onChange={(v) => {
                              if (v === 'default') {
                                onCommitAttributionChange(undefined);
                              } else {
                                onCommitAttributionChange(
                                  commitAttribution ?? DASH_DEFAULT_ATTRIBUTION,
                                );
                              }
                            }}
                          />
                        }
                      />
                      <SettingsBlock description="Clear the field to disable attribution entirely.">
                        <textarea
                          value={
                            commitAttribution === undefined
                              ? (claudeDefaultAttribution ?? DASH_DEFAULT_ATTRIBUTION)
                              : commitAttribution
                          }
                          onChange={(e) => onCommitAttributionChange(e.target.value)}
                          readOnly={commitAttribution === undefined}
                          rows={3}
                          className={`w-full px-3 py-2.5 rounded-lg text-[12px] font-mono border bg-transparent resize-none ${
                            commitAttribution === undefined
                              ? 'border-border/40 text-foreground/40 cursor-default'
                              : 'border-border/60 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40'
                          }`}
                        />
                      </SettingsBlock>
                    </SettingsCard>
                  </SettingsPane>
                )}

                {tab === 'diff' && (
                  <SettingsPane key={`pane-${tab}`}>
                    <SettingsCard title="Context">
                      <SettingsRow
                        label="Context lines"
                        description="Unchanged lines shown around each change."
                        align="start"
                        control={
                          <Segmented
                            fullWidth={false}
                            size="sm"
                            value={diffContextLines === null ? 'full' : String(diffContextLines)}
                            options={[
                              { value: 'full', label: 'Full' },
                              { value: '3', label: '3' },
                              { value: '10', label: '10' },
                              { value: '50', label: '50' },
                            ]}
                            onChange={(v) =>
                              onDiffContextLinesChange(v === 'full' ? null : Number(v))
                            }
                          />
                        }
                      />
                    </SettingsCard>
                  </SettingsPane>
                )}

                {tab === 'terminal' && (
                  <SettingsPane key={`pane-${tab}`}>
                    <SettingsCard title="Shell drawer" hint="Cmd+J">
                      <SettingsRow
                        label="Show shell drawer"
                        description="Run git, npm, and other commands alongside Claude."
                        control={
                          <Switch
                            enabled={shellDrawerEnabled}
                            onToggle={onShellDrawerEnabledChange}
                          />
                        }
                      />
                      {shellDrawerEnabled && (
                        <SettingsBlock label="Position">
                          <Segmented
                            value={shellDrawerPosition}
                            options={[
                              { value: 'main', label: 'Main' },
                              { value: 'right', label: 'Right' },
                            ]}
                            onChange={onShellDrawerPositionChange}
                          />
                        </SettingsBlock>
                      )}
                    </SettingsCard>
                  </SettingsPane>
                )}

                {tab === 'ide' && (
                  <SettingsPane key={`pane-${tab}`}>
                    <SettingsCard title="Preferred IDE">
                      <SettingsBlock
                        description={
                          availableIDEs.length === 0
                            ? 'No supported IDE detected. Install Cursor, VS Code, Windsurf, Antigravity, or Zed — or configure a Custom IDE below.'
                            : 'Used when opening a task from the header. Only installed IDEs are shown.'
                        }
                      >
                        <Segmented
                          value={preferredIDE}
                          options={[
                            ...(availableIDEs.length > 0
                              ? [
                                  { value: 'auto', label: 'Auto' },
                                  ...availableIDEs.map((i) => ({ value: i.id, label: i.label })),
                                ]
                              : []),
                            { value: 'custom', label: 'Custom' },
                          ]}
                          onChange={onPreferredIDEChange}
                        />
                      </SettingsBlock>
                      {preferredIDE === 'custom' && (
                        <SettingsBlock label="Custom IDE command">
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[10.5px] text-foreground/55 mb-1.5">
                                Executable path
                              </label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={customIDE.path}
                                  onChange={(e) =>
                                    onCustomIDEChange({ ...customIDE, path: e.target.value })
                                  }
                                  placeholder="/Applications/MyIDE.app/Contents/MacOS/myide"
                                  className="flex-1 px-3 py-2 text-[11.5px] rounded-md border border-border/60 bg-background text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono"
                                />
                                <button
                                  onClick={async () => {
                                    const res = await window.electronAPI.pickExecutable();
                                    if (!res.success) {
                                      toast.error(res.error || 'Failed to open file picker');
                                      return;
                                    }
                                    if (res.data) {
                                      onCustomIDEChange({ ...customIDE, path: res.data });
                                    }
                                  }}
                                  className="px-3 py-2 text-[11.5px] rounded-md border border-border/60 text-foreground/80 hover:bg-accent/40 hover:text-foreground flex items-center gap-1.5"
                                >
                                  <FolderOpen size={12} strokeWidth={1.8} />
                                  Browse
                                </button>
                              </div>
                            </div>
                            <div>
                              <label className="block text-[10.5px] text-foreground/55 mb-1.5">
                                Arguments (one per line)
                              </label>
                              <textarea
                                value={customIDE.args.join('\n')}
                                onChange={(e) =>
                                  onCustomIDEChange({
                                    ...customIDE,
                                    args: e.target.value
                                      .split('\n')
                                      .filter((line) => line.length > 0),
                                  })
                                }
                                rows={3}
                                placeholder={'--new-window\n{path}'}
                                className="w-full px-3 py-2 text-[11.5px] rounded-md border border-border/60 bg-background text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono resize-y"
                              />
                              <p className="text-[10.5px] text-foreground/45 mt-1.5 leading-relaxed">
                                Use <code className="text-foreground/65">{'{path}'}</code> to place
                                the folder anywhere; otherwise it&apos;s appended.
                              </p>
                            </div>
                          </div>
                        </SettingsBlock>
                      )}
                    </SettingsCard>
                  </SettingsPane>
                )}

                {tab === 'notifications' && (
                  <SettingsPane key={`pane-${tab}`}>
                    <SettingsCard title="When a task finishes">
                      <SettingsRow
                        label="Desktop notification"
                        description="Includes the task name."
                        control={
                          <Switch
                            enabled={desktopNotification}
                            onToggle={onDesktopNotificationChange}
                          />
                        }
                      />
                      <SettingsBlock label="Sound">
                        <div className="flex flex-wrap gap-2">
                          {NOTIFICATION_SOUNDS.map((sound) => {
                            const isActive = notificationSound === sound;
                            return (
                              <button
                                key={sound}
                                onClick={() => onNotificationSoundChange(sound)}
                                className={`px-3 py-1.5 rounded-md text-[11.5px] border transition-all duration-150 ${
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
                      </SettingsBlock>
                    </SettingsCard>
                  </SettingsPane>
                )}

                {tab === 'about' && (
                  <SettingsPane key={`pane-${tab}`}>
                    <div
                      className="relative overflow-hidden rounded-xl border border-border/40 p-5"
                      style={{
                        background:
                          'linear-gradient(135deg, hsl(var(--surface-2)) 0%, hsl(var(--surface-1)) 100%)',
                      }}
                    >
                      <div
                        aria-hidden
                        className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-30 blur-3xl"
                        style={{ background: 'hsl(var(--primary) / 0.35)' }}
                      />
                      <div className="relative flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-primary/12 ring-1 ring-primary/25 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.08)]">
                          <Sparkles size={20} strokeWidth={1.5} className="text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-foreground tracking-tight">
                            Dash
                          </p>
                          <p className="text-[11.5px] text-muted-foreground font-mono mt-0.5">
                            {appVersion ? `v${appVersion}` : 'version loading…'}
                          </p>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11.5px] text-muted-foreground leading-relaxed px-1">
                      A multi-task desktop for Claude Code, built by{' '}
                      <a
                        href="https://syv.ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        syv.ai
                      </a>
                      .
                    </p>
                  </SettingsPane>
                )}

                {tab === 'updates' && (
                  <SettingsPane key={`pane-${tab}`}>
                    <SettingsCard title="Status">
                      <div className="flex items-center gap-3 px-4 py-3.5">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            updateStatus === 'ready' || updateStatus === 'available'
                              ? 'bg-[hsl(var(--git-added)/0.12)] ring-1 ring-[hsl(var(--git-added))/0.25]'
                              : 'bg-[hsl(var(--surface-3))] ring-1 ring-border/40'
                          }`}
                        >
                          {updateStatus === 'ready' || updateStatus === 'available' ? (
                            <Download
                              size={15}
                              className="text-[hsl(var(--git-added))]"
                              strokeWidth={1.8}
                            />
                          ) : (
                            <Check size={15} className="text-muted-foreground" strokeWidth={1.8} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] font-medium text-foreground">
                            {updateStatus === 'ready'
                              ? `Update ready${updateVersion ? ` — v${updateVersion}` : ''}`
                              : updateStatus === 'available'
                                ? `Update available${updateVersion ? ` — v${updateVersion}` : ''}`
                                : updateStatus === 'downloading'
                                  ? 'Downloading update…'
                                  : updateStatus === 'checking'
                                    ? 'Checking for updates…'
                                    : 'You’re up to date'}
                          </p>
                          <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                            {appVersion ? `Current v${appVersion}` : 'Loading…'}
                          </p>
                        </div>
                        {updateStatus === 'ready' ? (
                          <button
                            onClick={() => window.electronAPI.autoUpdateQuitAndInstall()}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium border border-primary/40 bg-primary/10 text-foreground ring-1 ring-primary/20 hover:bg-primary/15 transition-all duration-150"
                          >
                            <Download size={12} strokeWidth={2} />
                            Restart
                          </button>
                        ) : updateStatus === 'available' ? (
                          <button
                            onClick={() => {
                              setUpdateStatus('downloading');
                              window.electronAPI.autoUpdateDownload();
                            }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium border border-primary/40 bg-primary/10 text-foreground ring-1 ring-primary/20 hover:bg-primary/15 transition-all duration-150"
                          >
                            <Download size={12} strokeWidth={2} />
                            Download
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setUpdateStatus('checking');
                              window.electronAPI.autoUpdateCheck().then((resp) => {
                                if (!resp.success) setUpdateStatus('idle');
                              });
                            }}
                            disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                            className="px-3 py-2 rounded-lg text-[12px] border border-border/60 text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-all duration-150 disabled:opacity-50"
                          >
                            Check
                          </button>
                        )}
                      </div>
                    </SettingsCard>

                    <SettingsCard title="Behavior">
                      <SettingsRow
                        label="Check automatically"
                        description="When off, Dash won't check in the background."
                        control={
                          <Switch
                            enabled={autoUpdateEnabled}
                            onToggle={onAutoUpdateEnabledChange}
                          />
                        }
                      />
                      <SettingsRow
                        label="Show update notifications"
                        description="Toast popups when an update is available, downloaded, or fails."
                        control={
                          <Switch
                            enabled={updateNotificationsEnabled}
                            onToggle={onUpdateNotificationsEnabledChange}
                          />
                        }
                      />
                    </SettingsCard>
                  </SettingsPane>
                )}

                {tab === 'privacy' && (
                  <SettingsPane key={`pane-${tab}`}>
                    <SettingsCard title="Telemetry">
                      <SettingsRow
                        label="Send anonymous usage data"
                        description="Helps us understand how Dash is used so we can improve it."
                        align="start"
                        control={
                          <Switch
                            enabled={telemetryEnabled && !telemetryEnvDisabled}
                            disabled={telemetryEnvDisabled}
                            onToggle={(next) => {
                              setTelemetryEnabled(next);
                              window.electronAPI.telemetrySetEnabled(next);
                            }}
                          />
                        }
                      />
                      <SettingsBlock>
                        <div className="text-[11px] text-muted-foreground leading-relaxed space-y-1.5">
                          <p>
                            <span className="font-medium text-foreground/80">What we collect:</span>{' '}
                            app start/close, session duration, daily active usage, project and task
                            counts, worktree and terminal usage, app version, platform, and
                            architecture.
                          </p>
                          <p>
                            <span className="font-medium text-foreground/80">
                              What we never collect:
                            </span>{' '}
                            no code, file paths, prompts, IP addresses, device identifiers, MAC
                            addresses, or any personal information.
                          </p>
                          {telemetryEnvDisabled && (
                            <p className="flex items-center gap-1 text-[hsl(var(--git-modified))]">
                              <AlertCircle size={11} strokeWidth={2} />
                              Disabled via TELEMETRY_ENABLED env var
                            </p>
                          )}
                        </div>
                      </SettingsBlock>
                    </SettingsCard>
                  </SettingsPane>
                )}

                {tab === 'appearance' && (
                  <SettingsPane key={`pane-${tab}`}>
                    <SettingsCard title="App theme">
                      <SettingsBlock>
                        <Segmented
                          value={theme}
                          options={[
                            {
                              value: 'light',
                              label: 'Light',
                              icon: <Sun size={13} strokeWidth={1.8} />,
                            },
                            {
                              value: 'dark',
                              label: 'Dark',
                              icon: <Moon size={13} strokeWidth={1.8} />,
                            },
                          ]}
                          onChange={onThemeChange}
                        />
                      </SettingsBlock>
                    </SettingsCard>

                    <SettingsCard title="Terminal palette" hint="Main pane only">
                      <div className="p-4">
                        <div className="grid grid-cols-3 gap-2.5">
                          {TERMINAL_THEMES.map((t) => {
                            const isActive = terminalTheme === t.id;
                            const bg =
                              t.id === 'default'
                                ? theme === 'dark'
                                  ? (darkTheme.background ?? '#0d0d11')
                                  : (lightTheme.background ?? '#faf8f3')
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
                                className={`group flex flex-col gap-2 p-2.5 rounded-lg border transition-all duration-150 ${
                                  isActive
                                    ? 'border-primary/45 ring-1 ring-primary/25 bg-[hsl(var(--surface-3))]'
                                    : 'border-border/50 hover:border-border hover:bg-[hsl(var(--surface-3)/0.5)]'
                                }`}
                              >
                                <div
                                  className="w-full h-7 rounded-md flex items-center gap-[4px] px-2 shadow-inner"
                                  style={{ background: bg }}
                                >
                                  {colors.map((c, i) => (
                                    <span
                                      key={i}
                                      className="w-[7px] h-[7px] rounded-full"
                                      style={{
                                        background: c,
                                        boxShadow: `0 0 4px ${c}66`,
                                      }}
                                    />
                                  ))}
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10.5px] font-medium truncate text-foreground/85">
                                    {t.name}
                                  </span>
                                  {t.id === 'default' && (
                                    <span className="text-[9px] text-foreground/40 font-mono uppercase tracking-wide">
                                      auto
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </SettingsCard>

                    <SettingsCard title="Terminal font" hint="Main pane and shell drawer">
                      <SettingsBlock>
                        <Select
                          value={terminalFontFamily}
                          onValueChange={onTerminalFontFamilyChange}
                          options={TERMINAL_FONTS.map((f) => ({ value: f.id, label: f.label }))}
                          renderOption={(opt) => (
                            <span style={{ fontFamily: resolveTerminalFontValue(opt.value) }}>
                              {opt.label}
                            </span>
                          )}
                        />
                      </SettingsBlock>
                    </SettingsCard>
                  </SettingsPane>
                )}

                {tab === 'claude-code' && (
                  <ClaudeCodeTab
                    effortLevel={effortLevel}
                    onEffortLevelChange={onEffortLevelChange}
                    syncShellEnv={syncShellEnv}
                    onSyncShellEnvChange={onSyncShellEnvChange}
                    customEnvVars={customClaudeEnvVars}
                    onCustomEnvVarsChange={onCustomClaudeEnvVarsChange}
                    claudeInfo={claudeInfo}
                  />
                )}

                {tab === 'add-ons' && (
                  <SettingsPane key={`pane-${tab}`}>
                    <AddOnAccordion
                      title="RTK"
                      subtitle="Compress common shell-command output before Claude reads it."
                      status={
                        !rtkStatus
                          ? 'inactive'
                          : rtkStatus.installed && rtkStatus.enabled
                            ? 'active'
                            : rtkStatus.installed
                              ? 'pending'
                              : 'inactive'
                      }
                      statusLabel={
                        !rtkStatus
                          ? 'Checking…'
                          : rtkStatus.installed && rtkStatus.enabled
                            ? 'Active'
                            : rtkStatus.installed
                              ? 'Installed · off'
                              : 'Not installed'
                      }
                    >
                      <RtkSection
                        status={rtkStatus}
                        onEnabledChange={onRtkEnabledChange}
                        onDownload={onRtkDownload}
                        progress={rtkDownloadProgress}
                      />
                    </AddOnAccordion>
                  </SettingsPane>
                )}

                {tab === 'usage' && (
                  <UsageSection
                    latestRateLimits={latestRateLimits}
                    thresholds={usageThresholds}
                    onThresholdsChange={onUsageThresholdsChange}
                    showRateLimits={showRateLimits}
                    onShowRateLimitsChange={onShowRateLimitsChange}
                    showUsageInline={showUsageInline}
                    onShowUsageInlineChange={onShowUsageInlineChange}
                    showContextUsageOnTaskCards={showContextUsageOnTaskCards}
                    onShowContextUsageOnTaskCardsChange={onShowContextUsageOnTaskCardsChange}
                  />
                )}

                {tab === 'keybindings' && (
                  <SettingsPane key={`pane-${tab}`}>
                    {(() => {
                      const modifiedCount = Object.values(keybindings).filter(isModified).length;
                      return (
                        <div className="flex items-center justify-between -mt-1">
                          <p className="text-[11.5px] text-muted-foreground">
                            Click a shortcut to record a new binding.
                            {modifiedCount > 0 && (
                              <span className="ml-2 text-primary/85 font-medium">
                                {modifiedCount} modified
                              </span>
                            )}
                          </p>
                          <button
                            onClick={handleResetAll}
                            disabled={modifiedCount === 0}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] transition-all duration-150 ${
                              modifiedCount === 0
                                ? 'text-foreground/25 cursor-default'
                                : 'text-foreground/65 hover:text-foreground hover:bg-accent/50'
                            }`}
                          >
                            <RotateCcw size={10} strokeWidth={2} />
                            Reset all
                          </button>
                        </div>
                      );
                    })()}

                    {groups.map((group) => (
                      <SettingsCard key={group.category} title={group.category}>
                        {group.items.map((binding) => {
                          const modified = isModified(binding);
                          return (
                            <div
                              key={binding.id}
                              className={`relative group flex items-center justify-between gap-3 px-4 py-2 transition-colors duration-150 ${
                                modified
                                  ? 'bg-primary/[0.04] hover:bg-primary/[0.07]'
                                  : 'hover:bg-accent/20'
                              }`}
                            >
                              {modified && (
                                <span
                                  aria-hidden
                                  className="absolute left-0 top-1/2 -translate-y-1/2 h-[18px] w-[2px] rounded-r-full bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.5)]"
                                />
                              )}
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-[12.5px] text-foreground/85 truncate">
                                  {binding.label}
                                </span>
                                {modified && (
                                  <span className="text-[9.5px] font-medium tracking-[0.08em] uppercase text-primary/90 px-1.5 py-0.5 rounded-md bg-primary/10 border border-primary/20 flex-shrink-0">
                                    Modified
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <KeyRecorder
                                  binding={binding}
                                  modified={modified}
                                  onChange={(updated) => handleBindingChange(binding.id, updated)}
                                />
                                <Tooltip content={modified ? 'Reset to default' : 'No changes'}>
                                  <button
                                    onClick={() => handleResetOne(binding.id)}
                                    disabled={!modified}
                                    className={`p-1.5 rounded-md transition-all duration-150 ${
                                      modified
                                        ? 'text-primary/70 hover:text-primary hover:bg-primary/10'
                                        : 'text-foreground/20 cursor-default'
                                    }`}
                                  >
                                    <RotateCcw size={11} strokeWidth={2} />
                                  </button>
                                </Tooltip>
                              </div>
                            </div>
                          );
                        })}
                      </SettingsCard>
                    ))}

                    <SettingsCard title="Active tasks" hint="Not rebindable">
                      {[
                        { label: 'Next active task', keys: ['Ctrl', '⇥'] },
                        { label: 'Previous active task', keys: ['Ctrl', '⇧', '⇥'] },
                      ].map(({ label, keys }) => (
                        <div key={label} className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-[12.5px] text-foreground/80">{label}</span>
                          <div className="flex items-center gap-[3px]">
                            {keys.map((k) => (
                              <kbd
                                key={k}
                                className="min-w-[22px] h-[22px] flex items-center justify-center rounded-md bg-accent/60 text-[11px] text-foreground/70 font-mono px-1.5"
                              >
                                {k}
                              </kbd>
                            ))}
                          </div>
                        </div>
                      ))}
                    </SettingsCard>
                  </SettingsPane>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RtkStatusCardBody({ status }: { status: RtkStatus | null }) {
  if (!status) {
    return <p className="text-[11px] text-foreground/60">Checking…</p>;
  }
  if (status.installed) {
    return (
      <div className="space-y-0.5">
        <p className="text-[11px] text-foreground/60 font-mono">
          {status.version}
          <span className="ml-2 text-foreground/40">
            ({status.source === 'managed' ? 'managed by Dash' : 'on $PATH'})
          </span>
        </p>
        <p className="text-[11px] text-foreground/40 font-mono truncate">{status.path}</p>
      </div>
    );
  }
  if (status.downloadable) {
    return (
      <p className="text-[11px] text-foreground/60 leading-relaxed">
        Not installed. Dash can fetch the latest release directly — no sudo, no global $PATH
        changes, binary stays scoped to this app.
      </p>
    );
  }
  return (
    <p className="text-[11px] text-foreground/60 leading-relaxed">
      Not installed, and no prebuilt release is available for this platform. Install manually from{' '}
      <a
        href="https://github.com/rtk-ai/rtk"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline"
      >
        github.com/rtk-ai/rtk
      </a>
      .
    </p>
  );
}

function labelForProgress(progress: RtkDownloadProgress | null): {
  installing: boolean;
  installLabel: string;
} {
  if (!progress) return { installing: false, installLabel: 'Install RTK' };
  switch (progress.phase) {
    case 'downloading':
      return { installing: true, installLabel: `Downloading… ${progress.percent}%` };
    case 'verifying':
      return { installing: true, installLabel: 'Verifying…' };
    case 'extracting':
      return { installing: true, installLabel: 'Extracting…' };
    case 'done':
    case 'error':
      return { installing: false, installLabel: 'Install RTK' };
    default: {
      const _exhaustive: never = progress;
      void _exhaustive;
      return { installing: false, installLabel: 'Install RTK' };
    }
  }
}

function StatusOrb({ state }: { state: 'active' | 'inactive' | 'pending' | 'error' }) {
  const palette: Record<typeof state, { dot: string; halo: string }> = {
    active: { dot: 'hsl(var(--git-added))', halo: 'hsl(var(--git-added) / 0.55)' },
    pending: { dot: 'hsl(var(--git-modified))', halo: 'hsl(var(--git-modified) / 0.55)' },
    error: { dot: 'hsl(var(--destructive))', halo: 'hsl(var(--destructive) / 0.55)' },
    inactive: { dot: 'hsl(var(--border))', halo: 'transparent' },
  };
  const c = palette[state];
  return (
    <span
      className="inline-block w-[8px] h-[8px] rounded-full flex-shrink-0"
      style={{
        background: c.dot,
        boxShadow: state === 'inactive' ? 'none' : `0 0 0 1px ${c.halo}, 0 0 8px ${c.halo}`,
      }}
    />
  );
}

function AddOnAccordion({
  title,
  subtitle,
  status,
  statusLabel,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  status: 'active' | 'inactive' | 'pending' | 'error';
  statusLabel: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className="rounded-xl border border-border/40 overflow-hidden"
      style={{ background: 'hsl(var(--surface-2))' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/20 transition-colors duration-150"
        aria-expanded={open}
      >
        <StatusOrb state={status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-foreground">{title}</span>
            <span className="text-[10.5px] text-foreground/45 uppercase tracking-wide">
              {statusLabel}
            </span>
          </div>
          {subtitle && (
            <p className="text-[11px] text-foreground/50 mt-0.5 leading-relaxed">{subtitle}</p>
          )}
        </div>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={`text-foreground/40 flex-shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180' : 'rotate-0'
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-border/30 px-4 py-4 animate-fade-in">{children}</div>
      )}
    </section>
  );
}

function RtkSection({
  status,
  onEnabledChange,
  onDownload,
  progress,
}: {
  status: RtkStatus | null;
  onEnabledChange: (enabled: boolean) => void;
  onDownload: () => void;
  progress: RtkDownloadProgress | null;
}) {
  const loading = !status;

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<RtkTestResult | null>(null);

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    const resp = await window.electronAPI.rtkTest();
    setTesting(false);
    if (resp.success && resp.data) {
      setTestResult(resp.data);
    } else {
      setTestResult({ ok: false, error: resp.error ?? 'unknown IPC error' });
    }
  }

  const { installing, installLabel } = labelForProgress(progress);

  return (
    <div className="space-y-5">
      <p className="text-[11.5px] text-foreground/65 leading-relaxed">
        Typically cuts <b>60–90% of tokens</b> per command. When enabled, Dash injects RTK&rsquo;s
        PreToolUse hook into every task automatically.{' '}
        <a
          href="https://github.com/rtk-ai/rtk"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-primary hover:underline"
        >
          Learn more
          <ExternalLink size={9} strokeWidth={1.8} />
        </a>
      </p>

      {/* Install status card */}
      <div
        className="flex items-start gap-3.5 p-4 rounded-xl border border-border/40"
        style={{ background: 'hsl(var(--surface-2))' }}
      >
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            status?.installed
              ? 'bg-[hsl(var(--git-added)/0.12)]'
              : 'bg-[hsl(var(--git-modified)/0.12)]'
          }`}
        >
          {status?.installed ? (
            <Check size={14} className="text-[hsl(var(--git-added))]" strokeWidth={1.8} />
          ) : (
            <AlertCircle size={14} className="text-[hsl(var(--git-modified))]" strokeWidth={1.8} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <RtkStatusCardBody status={status} />
        </div>
      </div>

      {/* Install button (only when not installed and platform is supported) */}
      {!loading && !status?.installed && status?.downloadable && (
        <div>
          <button
            onClick={onDownload}
            disabled={installing}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] border border-primary/40 bg-primary/8 text-foreground hover:bg-primary/12 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={12} strokeWidth={1.8} />
            {installLabel}
          </button>
          {progress?.phase === 'error' && (
            <p className="text-[11px] text-destructive mt-2">{progress.error}</p>
          )}
          {progress?.phase === 'done' && (
            <p className="text-[11px] text-[hsl(var(--git-added))] mt-2">
              Installed {progress.version ?? ''} — you can enable it below.
            </p>
          )}
        </div>
      )}

      {/* Enable toggle (requires install) */}
      <div>
        <label className="block text-[12px] font-medium text-foreground mb-3">
          Inject RTK hook in tasks
        </label>
        <ToggleSwitch
          enabled={status?.installed ? status.enabled : false}
          onToggle={onEnabledChange}
          disabled={!status?.installed}
          label="Compress Bash output via rtk before Claude reads it"
        />
        <p className="text-[10px] text-foreground/80 mt-2">
          Takes effect on the next command in every running task — no restart needed. Dash writes
          the hook into each task&rsquo;s local settings; your global{' '}
          <code className="px-1 py-0.5 rounded bg-accent/60 text-[9px] font-mono">
            ~/.claude/settings.json
          </code>{' '}
          is not modified. Do not also run{' '}
          <code className="px-1 py-0.5 rounded bg-accent/60 text-[9px] font-mono">rtk init -g</code>{' '}
          or the hook will run twice.
        </p>
      </div>

      {/* In-process verification — runs `rtk hook claude` against a synthetic
          `ls -la /tmp` payload and renders the rewrite it would emit. */}
      {status?.installed && (
        <div>
          <label className="block text-[12px] font-medium text-foreground mb-3">Verify</label>
          <button
            onClick={runTest}
            disabled={testing}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] border border-border/60 text-foreground/80 hover:bg-accent/40 hover:text-foreground transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? 'Testing…' : 'Test RTK'}
          </button>
          <p className="text-[10px] text-foreground/80 mt-2">
            Pipes a synthetic{' '}
            <code className="px-1 py-0.5 rounded bg-accent/60 text-[9px] font-mono">
              git status
            </code>{' '}
            through the same rtk binary Dash hands to Claude. Green means rtk rewrote the command —
            that&rsquo;s the compression path firing.
          </p>

          {testResult && <RtkTestResultCard result={testResult} />}
        </div>
      )}
    </div>
  );
}

function RtkTestResultCard({ result }: { result: RtkTestResult }) {
  if (!result.ok) {
    return (
      <div
        className="mt-3 flex items-start gap-3 p-3 rounded-lg border border-destructive/40"
        style={{ background: 'hsl(var(--destructive) / 0.06)' }}
      >
        <AlertCircle size={14} className="text-destructive mt-0.5" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-destructive">Test failed</p>
          <p className="text-[11px] text-foreground/70 font-mono mt-1 break-all">{result.error}</p>
        </div>
      </div>
    );
  }

  switch (result.outcome.kind) {
    case 'blocked':
      return (
        <div
          className="mt-3 flex items-start gap-3 p-3 rounded-lg border border-[hsl(var(--git-modified))]/40"
          style={{ background: 'hsl(var(--git-modified) / 0.06)' }}
        >
          <AlertCircle
            size={14}
            className="text-[hsl(var(--git-modified))] mt-0.5"
            strokeWidth={1.8}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[11px] font-medium text-foreground">
              rtk blocked this command (exit 2).
            </p>
            {result.outcome.stderr && (
              <p className="text-[11px] text-foreground/70 font-mono break-all">
                {result.outcome.stderr}
              </p>
            )}
          </div>
        </div>
      );

    case 'rewritten': {
      const diff = result.outcome.execDiff;
      const okDiff = diff && diff.kind === 'ok' ? diff : null;
      const failedDiff = diff && diff.kind === 'failed' ? diff : null;
      const savedBytes = okDiff ? okDiff.rawBytes - okDiff.compressedBytes : 0;
      const savedPct =
        okDiff && okDiff.rawBytes > 0 ? Math.round((savedBytes / okDiff.rawBytes) * 100) : 0;

      return (
        <div
          className="mt-3 p-3 rounded-lg border border-[hsl(var(--git-added))]/40 space-y-3"
          style={{ background: 'hsl(var(--git-added) / 0.06)' }}
        >
          <div className="flex items-start gap-3">
            <Check size={14} className="text-[hsl(var(--git-added))] mt-0.5" strokeWidth={1.8} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-[11px] font-medium text-foreground">
                Compression active — rtk would rewrite this command.
              </p>
              <div className="text-[11px] text-foreground/70 font-mono space-y-0.5">
                <div>
                  <span className="text-foreground/40">in: </span>
                  {result.testedCommand}
                </div>
                <div>
                  <span className="text-foreground/40">out:</span> {result.outcome.rewrittenCommand}
                </div>
              </div>
            </div>
          </div>

          {okDiff && (
            <div className="space-y-2 pt-2 border-t border-border/40">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wide text-foreground/60">
                  Actual output diff
                </span>
                {okDiff.rawBytes > 0 && (
                  <span className="text-[10px] font-mono text-[hsl(var(--git-added))]">
                    {okDiff.rawBytes} → {okDiff.compressedBytes} bytes
                    {savedBytes > 0 && ` (−${savedPct}%)`}
                    {okDiff.truncated && ' · truncated'}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <OutputPanel label="raw" body={okDiff.rawStdout} />
                <OutputPanel label="via rtk" body={okDiff.compressedStdout} accented />
              </div>
            </div>
          )}

          {failedDiff && (
            <div
              className="space-y-1 pt-2 border-t border-border/40"
              style={{ borderColor: 'hsl(var(--git-modified) / 0.3)' }}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--git-modified))]">
                Couldn&rsquo;t capture diff
              </span>
              <p className="text-[11px] text-foreground/70">{failedDiff.reason}</p>
              {failedDiff.stderr && (
                <pre className="text-[10px] text-foreground/50 font-mono whitespace-pre-wrap break-words">
                  {failedDiff.stderr}
                </pre>
              )}
            </div>
          )}
        </div>
      );
    }

    case 'pass-through':
      return (
        <div
          className="mt-3 flex items-start gap-3 p-3 rounded-lg border border-border/40"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <AlertCircle
            size={14}
            className="text-[hsl(var(--git-modified))] mt-0.5"
            strokeWidth={1.8}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-foreground">
              rtk ran without crashing, but chose not to rewrite this command.
            </p>
            <p className="text-[10px] text-foreground/60 mt-1">
              That&rsquo;s valid — rtk only compresses commands in its rewrite list. The hook
              plumbing is working; it would compress commands like{' '}
              <code className="text-foreground/80">git status</code> or{' '}
              <code className="text-foreground/80">cargo test</code> during real use.
            </p>
          </div>
        </div>
      );

    default: {
      const _exhaustive: never = result.outcome;
      void _exhaustive;
      return null;
    }
  }
}

function OutputPanel({
  label,
  body,
  accented,
}: {
  label: string;
  body: string;
  accented?: boolean;
}) {
  const displayBody = body.trim().length > 0 ? body : '(empty)';
  return (
    <div
      className={`rounded-md border text-[10px] font-mono leading-[1.35] overflow-hidden ${
        accented ? 'border-[hsl(var(--git-added))]/40' : 'border-border/50'
      }`}
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      <div
        className={`px-2 py-1 text-[9px] font-sans uppercase tracking-wide ${
          accented
            ? 'text-[hsl(var(--git-added))] bg-[hsl(var(--git-added))]/5'
            : 'text-foreground/50 bg-[hsl(var(--surface-2))]'
        }`}
      >
        {label}
      </div>
      <pre className="px-2 py-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words text-foreground/80">
        {displayBody}
      </pre>
    </div>
  );
}
