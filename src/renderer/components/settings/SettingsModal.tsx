import React, { useEffect, useId, useState } from 'react';
import { toast } from '../ui/toast';
import {
  Activity,
  AlertCircle,
  Bell,
  ChartLine,
  Code2,
  Download,
  FolderOpen,
  GitCommit,
  HeartPulse,
  Info,
  Keyboard,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Sparkles,
  Sun,
} from 'lucide-react';
import appIcon from '../../../../build/icon.svg';
import type { AutoUpdateStatus, ClaudeCliInfo, RateLimits } from '../../../shared/types';
import { NOTIFICATION_SOUNDS, SOUND_LABELS, playNotificationSound } from '../../sounds';
import type { NotificationSound } from '../../sounds';
import { TERMINAL_THEMES, resolveTheme } from '../../terminal/terminalThemes';
import { TERMINAL_FONTS, resolveTerminalFontValue } from '../../terminal/terminalFonts';
import { KEPT_READY_MAX, KEPT_READY_MIN } from '../../terminal/keptTerminals';
import { formatCheckedAt, updateHeadline } from '../../utils/updateStatus';
import { AUTO_SLEEP_CHOICES, AUTO_SLEEP_LABELS } from '../../lib/autoSleep';
import { useIsDark } from '../../hooks/useIsDark';
import { useRuntime } from '../../stores/runtimeStore';
import { useSettings } from '../../stores/settingsStore';
import {
  MEMORY_WARNING_MAX_GB,
  MEMORY_WARNING_MIN_GB,
  clampMemoryWarningGb,
} from '../../../shared/systemHealth';
import { Button } from '../ui/Button';
import { Code } from '../ui/Code';
import { DetailItem, DetailList } from '../ui/DetailList';
import { Dialog, NavDialogLayout, type NavDialogItem } from '../ui/Dialog';
import { Dot } from '../ui/Dot';
import { FormSection, SettingRow } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { Meter } from '../ui/Meter';
import { Notice } from '../ui/Notice';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';
import { Slider } from '../ui/Slider';
import { SwatchStrip } from '../ui/Swatch';
import { SwitchField } from '../ui/SwitchField';
import { TextLink } from '../ui/TextLink';
import { Textarea } from '../ui/Textarea';
import { ClaudeTab } from './ClaudeTab';
import { KEYBINDINGS_HINT, KeybindingsTab, ResetAllKeybindings } from './KeybindingsTab';
import { UsageTab } from './UsageTab';

const DASH_DEFAULT_ATTRIBUTION =
  '\n\nCo-Authored-By: Claude <noreply@anthropic.com> via Dash <dash@syv.ai>';

const RELEASES_URL = 'https://github.com/syv-ai/dash/releases';

/** PostHog's public, read-only share of the dashboard behind `docs/telemetry.md`. */
const TELEMETRY_DASHBOARD_URL = 'https://eu.posthog.com/shared/P-4kS1b8eR5ntVTBWAOtgMb5aI7mxw';
/** Every event and property Dash sends, and where it goes. */
const TELEMETRY_DOC_URL = 'https://github.com/syv-ai/dash/blob/main/docs/telemetry.md';

type SettingsTab =
  | 'appearance'
  | 'notifications'
  | 'ide'
  | 'attribution'
  | 'claude-code'
  | 'keybindings'
  | 'usage'
  | 'performance'
  | 'updates'
  | 'telemetry'
  | 'about';

const icon = (Icon: React.ComponentType<{ size: number; strokeWidth: number }>) => (
  <Icon size={14} strokeWidth={1.8} />
);

/** Each section's nav label and icon. */
const SECTIONS: Record<SettingsTab, { label: string; icon: React.ReactNode }> = {
  appearance: { label: 'Appearance', icon: icon(Palette) },
  notifications: { label: 'Notifications', icon: icon(Bell) },
  ide: { label: 'Editor', icon: icon(Code2) },
  attribution: { label: 'Attribution', icon: icon(GitCommit) },
  'claude-code': { label: 'Claude', icon: icon(Sparkles) },
  keybindings: { label: 'Keybindings', icon: icon(Keyboard) },
  usage: { label: 'Usage', icon: icon(Activity) },
  performance: { label: 'Performance', icon: icon(HeartPulse) },
  updates: { label: 'Updates', icon: icon(Download) },
  telemetry: { label: 'Telemetry', icon: icon(ChartLine) },
  about: { label: 'About', icon: icon(Info) },
};

const NAV_GROUPS: Array<{ label: string; ids: SettingsTab[] }> = [
  { label: 'Interface', ids: ['appearance', 'notifications'] },
  { label: 'Editor', ids: ['ide'] },
  { label: 'Workflow', ids: ['attribution', 'claude-code', 'keybindings', 'usage'] },
  { label: 'System', ids: ['performance', 'updates', 'telemetry', 'about'] },
];

const isTab = (v: string | undefined): v is SettingsTab => !!v && v in SECTIONS;

/** A section's element id, for a link into it (`initialTab` "performance#sessions"). */
const sectionId = (name: string) => `settings-section-${name}`;

interface SettingsModalProps {
  initialTab?: string;
  availableIDEs: Array<{ id: string; label: string }>;
  activeProjectPath?: string;
  latestRateLimits?: RateLimits;
  onClose: () => void;
}

export function SettingsModal({
  initialTab,
  availableIDEs,
  activeProjectPath,
  latestRateLimits,
  onClose,
}: SettingsModalProps) {
  const updateStatus = useRuntime((s) => s.updateStatus);
  // "tab" or "tab#section": a link can land on one section of a page.
  const [initialId, initialSection] = (initialTab ?? '').split('#');
  const [tab, setTab] = useState<SettingsTab>(isTab(initialId) ? initialId : 'appearance');
  useEffect(() => {
    if (!initialSection) return;
    document.getElementById(sectionId(initialSection))?.scrollIntoView({ block: 'start' });
  }, [initialSection]);
  const [claudeInfo, setClaudeInfo] = useState<ClaudeCliInfo | null>(null);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    void window.electronAPI.detectClaude().then((resp) => {
      if (resp.success) setClaudeInfo(resp.data ?? null);
    });
    void window.electronAPI.getAppVersion().then(setAppVersion);
  }, []);

  const updateAvailable = updateStatus?.state === 'available' || updateStatus?.state === 'ready';
  const groups = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.ids.map(
      (id): NavDialogItem<SettingsTab> => ({
        id,
        label: SECTIONS[id].label,
        icon: SECTIONS[id].icon,
        badge:
          id === 'updates' && updateAvailable ? <Dot tone="neutral" label="Update ready" /> : null,
      }),
    ),
  }));

  return (
    <Dialog size="nav" onClose={onClose}>
      <NavDialogLayout
        title="Settings"
        groups={groups}
        value={tab}
        onChange={setTab}
        heading={SECTIONS[tab].label}
        hint={tab === 'keybindings' ? KEYBINDINGS_HINT : undefined}
        actions={tab === 'keybindings' ? <ResetAllKeybindings /> : undefined}
        navFooter={appVersion ? `Dash ${appVersion}` : null}
      >
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'notifications' && <NotificationsTab />}
        {tab === 'ide' && <IdeTab availableIDEs={availableIDEs} />}
        {tab === 'attribution' && <AttributionTab activeProjectPath={activeProjectPath} />}
        {tab === 'claude-code' && <ClaudeTab claudeInfo={claudeInfo} />}
        {tab === 'keybindings' && <KeybindingsTab />}
        {tab === 'usage' && <UsageTab latestRateLimits={latestRateLimits} />}
        {tab === 'performance' && <PerformanceTab />}
        {tab === 'updates' && <UpdatesTab appVersion={appVersion} />}
        {tab === 'telemetry' && <TelemetryTab />}
        {tab === 'about' && (
          <AboutTab
            appVersion={appVersion}
            updateStatus={updateStatus}
            onShowUpdates={() => setTab('updates')}
          />
        )}
      </NavDialogLayout>
    </Dialog>
  );
}

function AppearanceTab() {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const terminalTheme = useSettings((s) => s.terminalTheme);
  const setTerminalTheme = useSettings((s) => s.setTerminalTheme);
  const terminalFontFamily = useSettings((s) => s.terminalFontFamily);
  const setTerminalFontFamily = useSettings((s) => s.setTerminalFontFamily);
  return (
    <>
      <FormSection>
        <SettingRow
          label="Theme"
          hint="System follows your OS's light or dark appearance as it changes."
          control={
            <Segmented
              aria-label="Theme"
              fullWidth={false}
              size="sm"
              value={theme}
              options={[
                { value: 'system', label: 'System', icon: icon(Monitor) },
                { value: 'light', label: 'Light', icon: icon(Sun) },
                { value: 'dark', label: 'Dark', icon: icon(Moon) },
              ]}
              onChange={setTheme}
            />
          }
        />
      </FormSection>

      <FormSection title="Terminal">
        <SettingRow
          label="Palette"
          hint="The task terminal's colours. Default follows the theme."
          control={
            <Select
              aria-label="Terminal palette"
              className="w-56"
              value={terminalTheme}
              onValueChange={setTerminalTheme}
              options={TERMINAL_THEMES.map((t) => ({ value: t.id, label: t.name }))}
              renderOption={(opt) => <PaletteOption id={opt.value} label={opt.label} />}
            />
          }
        />
        <SettingRow
          label="Font"
          hint="The task terminal and the shell drawer."
          control={
            <Select
              aria-label="Terminal font"
              className="w-56"
              value={terminalFontFamily}
              onValueChange={setTerminalFontFamily}
              options={TERMINAL_FONTS.map((f) => ({
                value: f.id,
                label: f.label,
                fontFamily: resolveTerminalFontValue(f.id),
              }))}
            />
          }
        />
      </FormSection>
    </>
  );
}

/** A terminal palette in the picker: its preview strip, then its name. */
function PaletteOption({ id, label }: { id: string; label: string }) {
  const dark = useIsDark();
  const t = TERMINAL_THEMES.find((x) => x.id === id);
  if (!t) return <>{label}</>;
  // 'default' follows the app's light/dark; the rest are fixed.
  const background = resolveTheme(t.id, dark).background || '#000';
  return (
    <span className="flex items-center gap-2">
      <SwatchStrip
        size="sm"
        background={background}
        colors={[t.theme.red, t.theme.green, t.theme.blue, t.theme.yellow, t.theme.magenta].map(
          (c) => c || '#888',
        )}
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

function NotificationsTab() {
  const sound = useSettings((s) => s.notificationSound);
  const setSound = useSettings((s) => s.setNotificationSound);
  const desktop = useSettings((s) => s.desktopNotification);
  const setDesktop = useSettings((s) => s.setDesktopNotification);
  const pickSound = (v: NotificationSound) => {
    setSound(v);
    if (v !== 'off') playNotificationSound(v);
  };

  return (
    <>
      <FormSection title="When a task finishes">
        <SwitchField
          label="Desktop notification"
          hint="Names the task. Only while Dash isn't focused."
          checked={desktop}
          onCheckedChange={setDesktop}
        />
        <SettingRow
          label="Sound"
          hint="Plays once when picked, so you can hear it."
          control={
            <Select
              aria-label="Sound"
              className="w-56"
              value={sound}
              onValueChange={pickSound}
              options={NOTIFICATION_SOUNDS.map((s) => ({ value: s, label: SOUND_LABELS[s] }))}
            />
          }
        />
      </FormSection>
    </>
  );
}

/** What Dash and its sessions cost the machine, and what keeps it down:
 *  Memory (the health icon, the warning, their threshold; SystemHealthService),
 *  Sessions (auto-sleep) and Terminals (how many stay ready). */
function PerformanceTab() {
  const icon = useSettings((s) => s.systemHealthIcon);
  const setIcon = useSettings((s) => s.setSystemHealthIcon);
  const warning = useSettings((s) => s.memoryWarning);
  const setWarning = useSettings((s) => s.setMemoryWarning);
  const gb = useSettings((s) => s.memoryWarningGb);
  const setGb = useSettings((s) => s.setMemoryWarningGb);
  const autoSleep = useSettings((s) => s.autoSleepAfter);
  const setAutoSleep = useSettings((s) => s.setAutoSleepAfter);
  const keptReady = useSettings((s) => s.terminalsKeptReady);
  const setKeptReady = useSettings((s) => s.setTerminalsKeptReady);
  // A draft while typing, so "0.5" isn't clamped at its "0"; kept on blur or Enter.
  const [draft, setDraft] = useState(String(gb));
  useEffect(() => setDraft(String(gb)), [gb]);
  const commit = () => {
    const next = clampMemoryWarningGb(parseFloat(draft));
    setDraft(String(next));
    if (next !== gb) setGb(next);
  };
  // The number follows the drag; the setting is saved (and applied) only on
  // release, so dragging 8→2→8 doesn't close six terminals on the way.
  const [keptReadyDraft, setKeptReadyDraft] = useState(keptReady);
  useEffect(() => setKeptReadyDraft(keptReady), [keptReady]);
  const id = useId();

  const thresholdOff = !icon && !warning;

  return (
    <>
      <FormSection title="Memory" id={sectionId('memory')}>
        <SwitchField
          label="Health icon"
          hint={{
            title: 'Beside Settings',
            body: 'Turns amber when Dash and its sessions pass the threshold or macOS reports memory pressure, and breathes when the pressure is critical. Click it to see what uses the memory and to put idle tasks to sleep.',
          }}
          checked={icon}
          onCheckedChange={setIcon}
        />
        <SwitchField
          label="Memory warning"
          hint={{
            title: 'Dash and its sessions',
            body: 'Counts Dash and every task session with its subagents, MCP servers and shells. Warns once when they pass the threshold, or when macOS reports memory pressure, and offers to put idle tasks to sleep. A desktop notification while Dash is in the background.',
          }}
          checked={warning}
          onCheckedChange={setWarning}
        />
        <SettingRow
          label="Threshold"
          hint="Dash and its sessions together. The icon and the warning both use it."
          htmlFor={id}
          disabled={thresholdOff}
          control={
            <span className="flex items-center gap-1.5">
              <Input
                id={id}
                type="number"
                min={MEMORY_WARNING_MIN_GB}
                max={MEMORY_WARNING_MAX_GB}
                step={0.5}
                value={draft}
                disabled={thresholdOff}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                }}
                className="w-16 text-right"
              />
              <span className="type-caption">GB</span>
            </span>
          }
        />
      </FormSection>

      <FormSection title="Sessions" id={sectionId('sessions')}>
        <SettingRow
          label="Sleep idle sessions"
          hint={{
            title: "Frees a session's memory",
            body: "Puts a task's session to sleep once it has sat at rest this long since you last saw it. A live session holds about 400 MB; a sleeping one holds nothing and wakes with its context when you open the task. Never a session that is working, waiting on you or finished unseen, the task on screen, a protected task, or one under remote control.",
          }}
          control={
            <Select
              aria-label="Sleep idle sessions"
              className="w-40"
              value={autoSleep}
              onValueChange={setAutoSleep}
              options={AUTO_SLEEP_CHOICES.map((v) => ({ value: v, label: AUTO_SLEEP_LABELS[v] }))}
            />
          }
        />
      </FormSection>

      <FormSection title="Terminals" id={sectionId('terminals')}>
        <SettingRow
          label="Kept ready"
          hint="Recently viewed task terminals that show instantly. An older task reconnects when you open it, taking a moment to redraw. Fewer use less memory."
          control={
            <span className="flex w-56 items-center gap-3">
              <Slider
                value={keptReadyDraft}
                onValueChange={setKeptReadyDraft}
                onValueCommit={setKeptReady}
                min={KEPT_READY_MIN}
                max={KEPT_READY_MAX}
                aria-label="Terminals kept ready"
              />
              <span className="type-body w-5 text-right tabular-nums">{keptReadyDraft}</span>
            </span>
          }
        />
      </FormSection>
    </>
  );
}

function IdeTab({ availableIDEs }: { availableIDEs: Array<{ id: string; label: string }> }) {
  const preferredIDE = useSettings((s) => s.preferredIDE);
  const setPreferredIDE = useSettings((s) => s.setPreferredIDE);
  const customIDE = useSettings((s) => s.customIDE);
  const setCustomIDE = useSettings((s) => s.setCustomIDE);
  const openFilesIn = useSettings((s) => s.openFilesIn);
  const setOpenFilesIn = useSettings((s) => s.setOpenFilesIn);
  const pathId = useId();
  const argsId = useId();

  async function browse() {
    const res = await window.electronAPI.pickExecutable();
    if (!res.success) {
      toast.error(res.error || 'Failed to open file picker');
      return;
    }
    if (res.data) setCustomIDE({ ...customIDE, path: res.data });
  }

  const ideOptions = [
    ...(availableIDEs.length > 0
      ? [
          { value: 'auto', label: 'Auto' },
          ...availableIDEs.map((i) => ({ value: i.id, label: i.label })),
        ]
      : []),
    { value: 'custom', label: 'Custom' },
  ];

  return (
    <>
      <FormSection title="Files">
        <SettingRow
          label="Open files in"
          hint={
            openFilesIn === 'dash'
              ? "A file path you click in a terminal opens in the task's editor, at its line. One outside the task's folder goes to the external editor."
              : 'A file path you click in a terminal opens in $VISUAL or $EDITOR, else the first of Cursor, VS Code or Zed found, else the system default.'
          }
          control={
            <Segmented
              aria-label="Open files in"
              fullWidth={false}
              size="sm"
              value={openFilesIn}
              options={[
                { value: 'dash', label: 'Dash editor' },
                { value: 'ide', label: 'External editor' },
              ]}
              onChange={setOpenFilesIn}
            />
          }
        />
      </FormSection>
      <FormSection title="IDE">
        <SettingRow
          label="Open tasks in"
          hint="Open in IDE on a task, a project, or a file or folder in the tree. Only installed IDEs are listed."
          note={
            availableIDEs.length === 0
              ? 'No supported IDE found (Cursor, VS Code, Windsurf, Antigravity, Zed).'
              : undefined
          }
          control={
            <Select
              aria-label="IDE"
              className="w-56"
              value={preferredIDE}
              onValueChange={setPreferredIDE}
              options={ideOptions}
            />
          }
        />
        {preferredIDE === 'custom' && (
          <>
            <SettingRow
              label="Executable"
              htmlFor={pathId}
              control={
                <span className="flex w-72 items-center gap-1">
                  <Input
                    id={pathId}
                    value={customIDE.path}
                    onChange={(e) => setCustomIDE({ ...customIDE, path: e.target.value })}
                    placeholder="/Applications/MyIDE.app/…/myide"
                  />
                  <IconButton title="Browse" onClick={() => void browse()}>
                    <FolderOpen size={14} strokeWidth={1.8} />
                  </IconButton>
                </span>
              }
            />
            <SettingRow
              label="Arguments"
              htmlFor={argsId}
              hint={
                <>
                  One per line. <Code>{'{path}'}</Code> places the folder; without it the folder
                  goes last.
                </>
              }
              control={
                <Textarea
                  id={argsId}
                  value={customIDE.args.join('\n')}
                  onChange={(e) =>
                    setCustomIDE({
                      ...customIDE,
                      args: e.target.value.split('\n').filter((line) => line.length > 0),
                    })
                  }
                  rows={2}
                  placeholder={'--new-window\n{path}'}
                  variant="code"
                  className="w-72 resize-none"
                />
              }
            />
          </>
        )}
      </FormSection>
    </>
  );
}

function AttributionTab({ activeProjectPath }: { activeProjectPath?: string }) {
  const attribution = useSettings((s) => s.commitAttribution);
  const setAttribution = useSettings((s) => s.setCommitAttribution);
  const [claudeDefault, setClaudeDefault] = useState<string | null>(null);
  const isDefault = attribution === undefined;

  useEffect(() => {
    void window.electronAPI.getClaudeAttribution(activeProjectPath).then((resp) => {
      if (resp.success && resp.data != null) setClaudeDefault(resp.data);
    });
  }, [activeProjectPath]);

  return (
    <FormSection>
      <SettingRow
        label="Commit trailer"
        hint={
          isDefault
            ? `Added to commits Claude makes for you. Default uses Claude Code’s own: ${(claudeDefault ?? DASH_DEFAULT_ATTRIBUTION).trim()}`
            : 'Added to commits Claude makes for you. Clear it for none.'
        }
        control={
          <Segmented
            aria-label="Commit trailer"
            fullWidth={false}
            size="sm"
            value={isDefault ? 'default' : 'custom'}
            options={[
              { value: 'default', label: 'Default' },
              { value: 'custom', label: 'Custom' },
            ]}
            onChange={(v) =>
              setAttribution(
                v === 'default'
                  ? undefined
                  : (attribution ?? claudeDefault ?? DASH_DEFAULT_ATTRIBUTION),
              )
            }
          />
        }
      >
        {!isDefault && (
          <Textarea
            aria-label="Custom commit trailer"
            value={attribution}
            onChange={(e) => setAttribution(e.target.value)}
            placeholder="No trailer"
            rows={3}
            className="resize-none"
          />
        )}
      </SettingRow>
    </FormSection>
  );
}

function UpdatesTab({ appVersion }: { appVersion: string }) {
  const status = useRuntime((s) => s.updateStatus);
  const check = useRuntime((s) => s.checkForUpdates);
  const install = useRuntime((s) => s.installUpdate);
  const autoUpdate = useSettings((s) => s.autoUpdateEnabled);
  const setAutoUpdate = useSettings((s) => s.setAutoUpdateEnabled);
  const announce = useSettings((s) => s.updateNotificationsEnabled);
  const setAnnounce = useSettings((s) => s.setUpdateNotificationsEnabled);
  const busy = status?.state === 'checking' || status?.state === 'downloading';

  return (
    <>
      <FormSection>
        <SettingRow
          label={updateHeadline(status)}
          note={
            <span className="tabular-nums">
              {appVersion ? `Dash ${appVersion}` : 'Loading…'}
              {status?.lastCheckAt ? ` · checked ${formatCheckedAt(status.lastCheckAt)}` : ''}
            </span>
          }
          control={
            status?.state === 'ready' ? (
              <Button size="sm" onClick={() => void install()}>
                <RefreshCw size={14} strokeWidth={1.8} />
                Restart to update
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void check()}
                disabled={!status?.initialized || busy}
              >
                Check now
              </Button>
            )
          }
        >
          {status?.state === 'downloading' && (
            <Meter role="progressbar" value={status.percent ?? 0} aria-label="Downloading update" />
          )}
          {status?.lastError && (
            <div className="grid gap-0.5">
              <p className="text-xs text-state-fail">{status.lastError}</p>
              <p className="type-caption">
                Details: <Code>logs/updater.log</Code> in Dash&rsquo;s data folder.
              </p>
            </div>
          )}
          {status?.availableVersion && (
            <p className="type-caption">
              <TextLink href={`${RELEASES_URL}/tag/v${status.availableVersion}`}>
                What&rsquo;s new in {status.availableVersion}
              </TextLink>
            </p>
          )}
        </SettingRow>
      </FormSection>

      <FormSection title="Behaviour">
        <SwitchField
          label="Update automatically"
          hint="Downloads in the background and installs when you quit."
          checked={autoUpdate}
          onCheckedChange={setAutoUpdate}
        />
        <SwitchField
          label="Announce new versions"
          hint="After an update, a toast links to what changed."
          checked={announce}
          onCheckedChange={setAnnounce}
        />
      </FormSection>
    </>
  );
}

function TelemetryTab() {
  const [enabled, setEnabled] = useState(true);
  const [envDisabled, setEnvDisabled] = useState(false);

  useEffect(() => {
    void window.electronAPI.telemetryGetStatus().then((resp) => {
      if (resp.success && resp.data) {
        setEnabled(resp.data.enabled);
        setEnvDisabled(resp.data.envDisabled);
      }
    });
  }, []);

  return (
    <>
      <FormSection>
        <SwitchField
          label="Send anonymous usage data"
          hint={{
            title: 'Counts, never content',
            body: 'How Dash is used and where it fails, as counts and rough durations. Never code, paths, prompts or anything personal.',
          }}
          checked={enabled && !envDisabled}
          disabled={envDisabled}
          onCheckedChange={(next) => {
            setEnabled(next);
            void window.electronAPI.telemetrySetEnabled(next);
          }}
        >
          {envDisabled && (
            <Notice icon={<AlertCircle size={14} strokeWidth={1.8} />}>
              Turned off by the <Code>TELEMETRY_ENABLED</Code> environment variable.
            </Notice>
          )}
        </SwitchField>
      </FormSection>

      <FormSection>
        <SettingRow
          label={<TextLink href={TELEMETRY_DASHBOARD_URL}>Public dashboard</TextLink>}
          hint="What we see, live, read-only on PostHog."
        />
        <SettingRow
          label={<TextLink href={TELEMETRY_DOC_URL}>What we collect</TextLink>}
          hint="Every event and property Dash sends, and where it goes."
        />
      </FormSection>
    </>
  );
}

function AboutTab({
  appVersion,
  updateStatus,
  onShowUpdates,
}: {
  appVersion: string;
  updateStatus: AutoUpdateStatus | null;
  onShowUpdates: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-4">
        <img src={appIcon} alt="" className="size-14 rounded-xl" />
        <div className="grid gap-0.5">
          <h3 className="type-title">Dash</h3>
          <p className="type-caption">A desktop for running Claude Code across projects.</p>
        </div>
      </div>

      <DetailList>
        <DetailItem label="Version" copy={appVersion || undefined}>
          <span className="tabular-nums">{appVersion || '…'}</span>
        </DetailItem>
        <DetailItem label="Updates">
          <TextLink onClick={onShowUpdates}>{updateHeadline(updateStatus)}</TextLink>
        </DetailItem>
      </DetailList>

      <p className="type-caption flex flex-wrap gap-x-3 gap-y-1">
        <TextLink href="https://syv.ai">syv.ai</TextLink>
        <TextLink href="https://github.com/syv-ai/dash">Source on GitHub</TextLink>
        <TextLink href={RELEASES_URL}>Release notes</TextLink>
      </p>
    </>
  );
}
