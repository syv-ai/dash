import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, Copy } from 'lucide-react';
import type { ClaudeCliInfo } from '../../../shared/types';
import { shellQuote } from '../../../shared/shellQuote';
import { useControlInfo } from '../../hooks/useControlInfo';
import { useSettings } from '../../stores/settingsStore';
import { Code } from '../ui/Code';
import { FormSection, SettingRow } from '../ui/Field';
import { EnvVarList } from '../ui/EnvVarList';
import { IconButton } from '../ui/IconButton';
import { Notice } from '../ui/Notice';
import { Segmented } from '../ui/Segmented';
import { Select, type SelectOption } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { SwitchField } from '../ui/SwitchField';
import { TextLink } from '../ui/TextLink';
import { DEFAULT_EFFORTS, EFFORT_LABELS, type DefaultEffort } from '../../../shared/effort';
import { EffortOption, effortDescription } from '../task/EffortPicker';
import { ModelPicker } from '../task/ModelPicker';
import { PermissionModePicker } from '../task/PermissionModePicker';

const DASH_DEFAULT_ATTRIBUTION =
  '\n\nCo-Authored-By: Claude <noreply@anthropic.com> via Dash <dash@syv.ai>';

/** `claude --version` says "2.1.332 (Claude Code)"; the number alone. */
function cliVersion(info: ClaudeCliInfo): string | null {
  return info.version?.replace(/\s*\(Claude Code\)\s*$/, '') ?? null;
}

export function ClaudeTab({
  claudeInfo,
  activeProjectPath,
}: {
  claudeInfo: ClaudeCliInfo | null;
  /** Whose Claude Code settings name the default commit trailer. */
  activeProjectPath?: string;
}) {
  const syncShellEnv = useSettings((s) => s.syncShellEnv);
  const setSyncShellEnv = useSettings((s) => s.setSyncShellEnv);
  const stopSessionsOnQuit = useSettings((s) => s.stopSessionsOnQuit);
  const setStopSessionsOnQuit = useSettings((s) => s.setStopSessionsOnQuit);

  return (
    <>
      <FormSection>
        <CliStatus info={claudeInfo} />
      </FormSection>

      <NewTaskDefaults />

      <FormSection title="Sessions">
        <SwitchField
          label="Inherit shell environment"
          hint={
            syncShellEnv
              ? 'Claude gets every variable Dash has; the ones below override them.'
              : 'Claude gets a minimal environment plus the variables below.'
          }
          checked={syncShellEnv}
          onCheckedChange={setSyncShellEnv}
        />
        <SwitchField
          label="Stop sessions on quit"
          hint={
            stopSessionsOnQuit
              ? 'Quitting Dash stops every task session. Opening a task resumes it from its transcript.'
              : 'Sessions keep running after Dash quits and are picked up on the next launch. Claude Code parks idle ones after about an hour.'
          }
          checked={stopSessionsOnQuit}
          onCheckedChange={setStopSessionsOnQuit}
        />
      </FormSection>

      <CommitsSection activeProjectPath={activeProjectPath} />

      <EnvVarsSection />

      <OrchestratorAccessSection />
    </>
  );
}

const EFFORT_OPTIONS: SelectOption<DefaultEffort>[] = DEFAULT_EFFORTS.map((e) => ({
  value: e,
  label: e === 'auto' ? 'Auto' : EFFORT_LABELS[e],
}));

/** What a new task starts with: its model, permission mode and effort. Each
 *  task changes its own; a project's permission mode default comes first. */
function NewTaskDefaults() {
  const model = useSettings((s) => s.newTaskModel);
  const setModel = useSettings((s) => s.setNewTaskModel);
  const mode = useSettings((s) => s.newTaskPermissionMode);
  const setMode = useSettings((s) => s.setNewTaskPermissionMode);
  const effort = useSettings((s) => s.effortLevel);
  const setEffort = useSettings((s) => s.setEffortLevel);

  return (
    <FormSection
      title="New tasks"
      hint={{
        title: 'Where a task starts',
        body: "New task opens on these. A task changes its own in New task or later in Task settings (its … menu), and a project's own defaults (Project settings → New tasks) come before these.",
      }}
    >
      <ModelPicker layout="row" value={model} onChange={setModel} />
      <PermissionModePicker layout="row" value={mode} onChange={setMode} />
      <SettingRow
        label="Effort"
        hint={
          effort === 'auto'
            ? 'Claude Code decides how much Claude reasons. Applies to tasks that keep Default in their own Effort; a session gets it when it starts or restarts.'
            : `${effortDescription(effort)} Applies to tasks that keep Default in their own Effort; a session gets it when it starts or restarts. A model without a level runs at the highest it has below it.`
        }
        control={
          <div className="w-56">
            <Select<DefaultEffort>
              aria-label="Effort"
              value={effort}
              onValueChange={setEffort}
              options={EFFORT_OPTIONS}
              renderOption={(opt) => <EffortOption label={opt.label} />}
            />
          </div>
        }
      />
    </FormSection>
  );
}

/** The trailer on commits Claude makes: Claude Code's own (its `attribution`
 *  setting for the project), or one of yours. */
function CommitsSection({ activeProjectPath }: { activeProjectPath?: string }) {
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
    <FormSection title="Commits">
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

/** Which Claude Code Dash found, and what to do when it's missing or old. */
function CliStatus({ info }: { info: ClaudeCliInfo | null }) {
  const installed = !!info?.installed;
  return (
    <SettingRow
      label="Claude Code"
      hint={installed ? (info?.path ?? undefined) : undefined}
      control={
        <span className="type-body tabular-nums">
          {!info ? 'Looking…' : installed ? cliVersion(info) : 'Not found'}
        </span>
      }
    >
      {info && !info.installed && (
        <Notice icon={<AlertCircle size={14} strokeWidth={1.8} />}>
          Install it with <Code>npm install -g @anthropic-ai/claude-code</Code>
        </Notice>
      )}
      {info?.installed && !info.supported && (
        <Notice icon={<AlertCircle size={14} strokeWidth={1.8} />}>
          Dash needs {info.minVersion} or newer. Run <Code>claude update</Code>
        </Notice>
      )}
    </SettingRow>
  );
}

/** The orchestrator switch and, when on, where `dashctl` is, for a session
 *  outside Dash to run. Hidden where the control API doesn't run (win32). */
function OrchestratorAccessSection() {
  const enabled = useSettings((s) => s.orchestratorAccess);
  const setEnabled = useSettings((s) => s.setOrchestratorAccess);
  const info = useControlInfo();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  if (!info?.supported) return null;
  const command = shellQuote(info.dashctlPath);

  return (
    <FormSection title="Other agents">
      <SwitchField
        label="Let other agents control Dash"
        hint={
          <>
            A Claude Code session outside Dash can create and drive tasks with <Code>dashctl</Code>.
            Holi&rsquo;s Dash plugin finds it by itself; elsewhere, run it by this path.
          </>
        }
        checked={enabled}
        onCheckedChange={setEnabled}
      >
        {enabled && (
          <div className="flex h-7.5 items-center gap-1 rounded-md bg-well pr-0.5 pl-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink-2 select-all">
              {command}
            </code>
            <IconButton
              size="sm"
              title={copied ? 'Copied' : 'Copy path'}
              onClick={() => {
                window.electronAPI.clipboardWriteText(command);
                setCopied(true);
              }}
            >
              {copied ? (
                <Check size={14} strokeWidth={1.8} />
              ) : (
                <Copy size={14} strokeWidth={1.8} />
              )}
            </IconButton>
          </div>
        )}
      </SwitchField>
    </FormSection>
  );
}

function EnvVarsSection() {
  const vars = useSettings((s) => s.customClaudeEnvVars);
  const setVars = useSettings((s) => s.setCustomClaudeEnvVars);
  return (
    <FormSection
      title="Environment variables"
      hint="Passed to every task's session when it starts. A task adds its own in Task settings › Advanced."
      action={<TextLink href="https://code.claude.com/docs/en/env-vars">Reference</TextLink>}
    >
      <EnvVarList value={vars} onChange={setVars} />
    </FormSection>
  );
}
