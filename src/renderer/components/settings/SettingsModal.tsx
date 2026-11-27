import React, { useEffect, useId, useState } from 'react';
import { toast } from '../ui/toast';
import {
  Activity,
  AlertCircle,
  Bell,
  Code2,
  Download,
  FolderOpen,
  GitCommit,
  Info,
  Keyboard,
  Moon,
  Palette,
  RefreshCw,
  Shield,
  Sparkles,
  Sun,
} from 'lucide-react';
import appIcon from '../../../../build/icon.svg';
import type { AutoUpdateStatus, ClaudeCliInfo, RateLimits } from '../../../shared/types';
import { NOTIFICATION_SOUNDS, SOUND_LABELS, playNotificationSound } from '../../sounds';
import type { NotificationSound } from '../../sounds';
import { TERMINAL_THEMES, resolveTheme } from '../../terminal/terminalThemes';
import { TERMINAL_FONTS, resolveTerminalFontValue } from '../../terminal/terminalFonts';
import { WEBGL_HELD_MAX, WEBGL_HELD_MIN } from '../../terminal/WebglLifecycle';
import { formatCheckedAt, updateHeadline } from '../../utils/updateStatus';
import { useRuntime } from '../../stores/runtimeStore';
import { useSettings } from '../../stores/settingsStore';
import { Button } from '../ui/Button';
import { Code } from '../ui/Code';
import { DetailItem, DetailList } from '../ui/DetailList';
import { Dialog, NavDialogLayout, type NavDialogItem } from '../ui/Dialog';
import { Dot } from '../ui/Dot';
import { Field, FormSection, SettingRow } from '../ui/Field';
import { Input } from '../ui/Input';
import { Meter } from '../ui/Meter';
import { Notice } from '../ui/Notice';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';
import { Slider } from '../ui/Slider';
import { SwatchOption } from '../ui/Swatch';
import { SwitchField } from '../ui/SwitchField';
import { TextLink } from '../ui/TextLink';
import { Textarea } from '../ui/Textarea';
import { ClaudeTab, cliVersion } from './ClaudeTab';
import { KeybindingsTab } from './KeybindingsTab';
import { UsageTab } from './UsageTab';

const DASH_DEFAULT_ATTRIBUTION =
  '\n\nCo-Authored-By: Claude <noreply@anthropic.com> via Dash <dash@syv.ai>';

const RELEASES_URL = 'https://github.com/syv-ai/dash/releases';

type SettingsTab =
  | 'appearance'
  | 'notifications'
  | 'ide'
  | 'attribution'
  | 'claude-code'
  | 'keybindings'
  | 'usage'
  | 'updates'
  | 'privacy'
  | 'about';

const icon = (Icon: React.ComponentType<{ size: number; strokeWidth: number }>) => (
  <Icon size={14} strokeWidth={1.8} />
);

/** Each section: its nav label and icon, and the line under its title. */
const SECTIONS: Record<SettingsTab, { label: string; description: string; icon: React.ReactNode }> =
  {
    appearance: { label: 'Appearance', description: 'Theme and terminals.', icon: icon(Palette) },
    notifications: {
      label: 'Notifications',
      description: 'How Dash tells you a task is done.',
      icon: icon(Bell),
    },
    ide: { label: 'IDE', description: 'The editor a task opens in.', icon: icon(Code2) },
    attribution: {
      label: 'Attribution',
      description: 'How commits Claude makes are signed.',
      icon: icon(GitCommit),
    },
    'claude-code': {
      label: 'Claude',
      description: 'Claude Code, its sessions and their environment.',
      icon: icon(Sparkles),
    },
    keybindings: { label: 'Keybindings', description: 'Keyboard shortcuts.', icon: icon(Keyboard) },
    usage: {
      label: 'Usage',
      description: 'Tokens, rate limits and alerts.',
      icon: icon(Activity),
    },
    updates: { label: 'Updates', description: 'Keeping Dash up to date.', icon: icon(Download) },
    privacy: {
      label: 'Privacy',
      description: 'The anonymous data Dash sends.',
      icon: icon(Shield),
    },
    about: { label: 'About', description: 'Versions and links.', icon: icon(Info) },
  };

const NAV_GROUPS: Array<{ label: string; ids: SettingsTab[] }> = [
  { label: 'Interface', ids: ['appearance', 'notifications'] },
  { label: 'Editor', ids: ['ide'] },
  { label: 'Workflow', ids: ['attribution', 'claude-code', 'keybindings', 'usage'] },
  { label: 'System', ids: ['updates', 'privacy', 'about'] },
];

const isTab = (v: string | undefined): v is SettingsTab => !!v && v in SECTIONS;

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
  const [tab, setTab] = useState<SettingsTab>(isTab(initialTab) ? initialTab : 'appearance');
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
        hint={SECTIONS[tab].description}
        navFooter={appVersion ? `Dash ${appVersion}` : null}
      >
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'notifications' && <NotificationsTab />}
        {tab === 'ide' && <IdeTab availableIDEs={availableIDEs} />}
        {tab === 'attribution' && <AttributionTab activeProjectPath={activeProjectPath} />}
        {tab === 'claude-code' && <ClaudeTab claudeInfo={claudeInfo} />}
        {tab === 'keybindings' && <KeybindingsTab />}
        {tab === 'usage' && <UsageTab latestRateLimits={latestRateLimits} />}
        {tab === 'updates' && <UpdatesTab appVersion={appVersion} />}
        {tab === 'privacy' && <PrivacyTab />}
        {tab === 'about' && (
          <AboutTab
            appVersion={appVersion}
            claudeInfo={claudeInfo}
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
  const webglHeldLimit = useSettings((s) => s.webglHeldLimit);
  const setWebglHeldLimit = useSettings((s) => s.setWebglHeldLimit);
  // The number follows the drag; the setting is saved (and applied) only on
  // release, so dragging 8→2→8 doesn't release six terminals on the way.
  const [webglHeldDraft, setWebglHeldDraft] = useState(webglHeldLimit);
  useEffect(() => setWebglHeldDraft(webglHeldLimit), [webglHeldLimit]);

  return (
    <>
      <FormSection title="Theme">
        <Segmented
          aria-label="Theme"
          fullWidth={false}
          value={theme}
          options={[
            { value: 'light', label: 'Light', icon: icon(Sun) },
            { value: 'dark', label: 'Dark', icon: icon(Moon) },
          ]}
          onChange={setTheme}
        />
      </FormSection>

      <FormSection title="Terminal">
        <SettingRow label="Palette" hint="The task terminal's colours.">
          <div role="radiogroup" aria-label="Terminal palette" className="grid grid-cols-3 gap-1">
            {TERMINAL_THEMES.map((t) => (
              <SwatchOption
                key={t.id}
                label={t.name}
                meta={t.id === 'default' ? 'Follows theme' : undefined}
                // 'default' follows the app light/dark; the rest are fixed.
                background={resolveTheme(t.id, theme === 'dark').background || '#000'}
                colors={[
                  t.theme.red || '#f00',
                  t.theme.green || '#0f0',
                  t.theme.blue || '#00f',
                  t.theme.yellow || '#ff0',
                  t.theme.magenta || '#f0f',
                  t.theme.cyan || '#0ff',
                ]}
                selected={terminalTheme === t.id}
                onSelect={() => setTerminalTheme(t.id)}
              />
            ))}
          </div>
        </SettingRow>
        <SettingRow
          label="Font"
          hint="The task terminal and the shell drawer."
          control={
            <Select
              aria-label="Terminal font"
              className="w-48"
              value={terminalFontFamily}
              onValueChange={setTerminalFontFamily}
              options={TERMINAL_FONTS.map((f) => ({ value: f.id, label: f.label }))}
              renderOption={(opt) => (
                <span style={{ fontFamily: resolveTerminalFontValue(opt.value) }}>{opt.label}</span>
              )}
            />
          }
        />
        <SettingRow
          label="Terminals kept ready"
          hint="Recent task terminals that show instantly. Fewer use less graphics memory, but an older task may flicker while it redraws."
        >
          <div className="flex items-center gap-3">
            <Slider
              value={webglHeldDraft}
              onValueChange={setWebglHeldDraft}
              onValueCommit={setWebglHeldLimit}
              min={WEBGL_HELD_MIN}
              max={WEBGL_HELD_MAX}
              aria-label="Terminals kept ready"
            />
            <span className="type-body w-5 text-right tabular-nums">{webglHeldDraft}</span>
          </div>
        </SettingRow>
      </FormSection>
    </>
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
    <FormSection title="When a task finishes">
      <SwitchField
        label="Desktop notification"
        hint="Names the task. Only while Dash isn't focused."
        checked={desktop}
        onCheckedChange={setDesktop}
      />
      <SettingRow label="Sound" hint="Plays once when picked, so you can hear it.">
        <Segmented
          aria-label="Sound"
          fullWidth={false}
          size="sm"
          value={sound}
          options={NOTIFICATION_SOUNDS.map((s) => ({ value: s, label: SOUND_LABELS[s] }))}
          onChange={pickSound}
        />
      </SettingRow>
    </FormSection>
  );
}

function IdeTab({ availableIDEs }: { availableIDEs: Array<{ id: string; label: string }> }) {
  const preferredIDE = useSettings((s) => s.preferredIDE);
  const setPreferredIDE = useSettings((s) => s.setPreferredIDE);
  const customIDE = useSettings((s) => s.customIDE);
  const setCustomIDE = useSettings((s) => s.setCustomIDE);
  const pathId = useId();

  async function browse() {
    const res = await window.electronAPI.pickExecutable();
    if (!res.success) {
      toast.error(res.error || 'Failed to open file picker');
      return;
    }
    if (res.data) setCustomIDE({ ...customIDE, path: res.data });
  }

  return (
    <FormSection>
      <SettingRow
        label="Open tasks in"
        hint={
          availableIDEs.length === 0
            ? 'No supported IDE found (Cursor, VS Code, Windsurf, Antigravity, Zed). Set up a custom one.'
            : 'Used by the task header’s Open button. Only installed IDEs are listed.'
        }
      >
        <Segmented
          aria-label="IDE"
          fullWidth={false}
          size="sm"
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
          onChange={setPreferredIDE}
        />
      </SettingRow>
      {preferredIDE === 'custom' && (
        <div className="grid gap-3 py-3">
          <Field label="Executable" as="div">
            <div className="flex gap-2">
              <Input
                id={pathId}
                aria-label="Executable"
                value={customIDE.path}
                onChange={(e) => setCustomIDE({ ...customIDE, path: e.target.value })}
                placeholder="/Applications/MyIDE.app/Contents/MacOS/myide"
              />
              <Button variant="secondary" onClick={() => void browse()}>
                <FolderOpen size={14} strokeWidth={1.8} />
                Browse
              </Button>
            </div>
          </Field>
          <Field
            label="Arguments, one per line"
            hint={
              <>
                <Code>{'{path}'}</Code> places the folder; without it the folder goes last.
              </>
            }
          >
            <Textarea
              value={customIDE.args.join('\n')}
              onChange={(e) =>
                setCustomIDE({
                  ...customIDE,
                  args: e.target.value.split('\n').filter((line) => line.length > 0),
                })
              }
              rows={3}
              placeholder={'--new-window\n{path}'}
              variant="code"
              className="resize-none"
            />
          </Field>
        </div>
      )}
    </FormSection>
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
            ? 'Added to commits Claude makes for you. Default uses Claude Code’s own.'
            : 'Added to commits Claude makes for you. Clear it for none.'
        }
        control={
          <Segmented
            aria-label="Attribution"
            fullWidth={false}
            size="sm"
            value={isDefault ? 'default' : 'custom'}
            options={[
              { value: 'default', label: 'Default' },
              { value: 'custom', label: 'Custom' },
            ]}
            onChange={(v) =>
              setAttribution(
                v === 'default' ? undefined : (attribution ?? DASH_DEFAULT_ATTRIBUTION),
              )
            }
          />
        }
      >
        <Textarea
          aria-label="Commit trailer"
          value={isDefault ? (claudeDefault ?? DASH_DEFAULT_ATTRIBUTION) : attribution}
          onChange={(e) => setAttribution(e.target.value)}
          readOnly={isDefault}
          placeholder="No trailer"
          rows={3}
          className="resize-none"
        />
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
          hint={
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
                Details are in <Code>logs/updater.log</Code> in Dash&rsquo;s data folder.
              </p>
            </div>
          )}
          {status?.availableVersion && (
            <p className="type-caption">
              <TextLink look="muted" href={`${RELEASES_URL}/tag/v${status.availableVersion}`}>
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

function PrivacyTab() {
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
    <FormSection>
      <SwitchField
        label="Send anonymous usage data"
        hint="Helps us see how Dash is used, so we can improve it."
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
      <div className="grid gap-3 py-3">
        <Field label="What is sent" as="div">
          <p className="type-body">
            App start, close and daily use; counts of projects, tasks, sessions, turns (with rough
            durations), reviews and file opens; errors with paths removed; where Claude Code behaves
            differently than Dash expects; the Dash and Claude Code versions, platform and
            architecture.
          </p>
        </Field>
        <Field label="What is never sent" as="div">
          <p className="type-body">
            Code, file paths, prompts, IP addresses, device identifiers, or anything personal.
          </p>
        </Field>
      </div>
    </FormSection>
  );
}

function AboutTab({
  appVersion,
  claudeInfo,
  updateStatus,
  onShowUpdates,
}: {
  appVersion: string;
  claudeInfo: ClaudeCliInfo | null;
  updateStatus: AutoUpdateStatus | null;
  onShowUpdates: () => void;
}) {
  const claudeVersion = !claudeInfo
    ? 'Checking…'
    : claudeInfo.installed
      ? (cliVersion(claudeInfo) ?? 'Unknown')
      : 'Not found';

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
        <DetailItem label="Claude Code" copy={claudeInfo?.installed ? claudeVersion : undefined}>
          <span className="tabular-nums">{claudeVersion}</span>
        </DetailItem>
        <DetailItem label="Updates">
          <TextLink look="quiet" onClick={onShowUpdates}>
            {updateHeadline(updateStatus)}
          </TextLink>
        </DetailItem>
      </DetailList>

      <p className="type-caption flex flex-wrap gap-x-3 gap-y-1">
        <TextLink look="muted" href="https://syv.ai">
          syv.ai
        </TextLink>
        <TextLink look="muted" href="https://github.com/syv-ai/dash">
          Source on GitHub
        </TextLink>
        <TextLink look="muted" href={RELEASES_URL}>
          Release notes
        </TextLink>
      </p>
    </>
  );
}
