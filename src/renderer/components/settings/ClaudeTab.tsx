import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, Copy, Plus, Trash2 } from 'lucide-react';
import type { ClaudeCliInfo } from '../../../shared/types';
import { shellQuote } from '../../../shared/shellQuote';
import { useControlInfo } from '../../hooks/useControlInfo';
import { useSettings } from '../../stores/settingsStore';
import { Code } from '../ui/Code';
import { FormSection, SettingRow } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { Notice } from '../ui/Notice';
import { Segmented } from '../ui/Segmented';
import { SwitchField } from '../ui/SwitchField';
import { TextLink } from '../ui/TextLink';

const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `claude --version` says "2.1.332 (Claude Code)"; the number alone. */
export function cliVersion(info: ClaudeCliInfo): string | null {
  return info.version?.replace(/\s*\(Claude Code\)\s*$/, '') ?? null;
}

export function ClaudeTab({ claudeInfo }: { claudeInfo: ClaudeCliInfo | null }) {
  const effortLevel = useSettings((s) => s.effortLevel);
  const setEffortLevel = useSettings((s) => s.setEffortLevel);
  const syncShellEnv = useSettings((s) => s.syncShellEnv);
  const setSyncShellEnv = useSettings((s) => s.setSyncShellEnv);
  const ultracode = useSettings((s) => s.ultracode);
  const setUltracode = useSettings((s) => s.setUltracode);
  const stopSessionsOnQuit = useSettings((s) => s.stopSessionsOnQuit);
  const setStopSessionsOnQuit = useSettings((s) => s.setStopSessionsOnQuit);

  return (
    <>
      <FormSection title="Claude Code">
        <CliStatus info={claudeInfo} />
      </FormSection>

      <FormSection title="Sessions">
        <SettingRow
          label="Effort"
          hint="How much Claude reasons. Auto lets the model decide; X-High and Max need a newer model (Opus 4.8 and up), others use their highest level."
        >
          <Segmented
            fullWidth={false}
            size="sm"
            aria-label="Effort"
            value={effortLevel}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'xhigh', label: 'X-High' },
              { value: 'max', label: 'Max' },
            ]}
            onChange={setEffortLevel}
          />
        </SettingRow>
        <SwitchField
          label="Ultracode"
          hint="New sessions start with X-High reasoning and multi-agent orchestration. Uses more tokens and runs slower, and overrides Effort. Applies when a session next starts."
          checked={ultracode}
          onCheckedChange={setUltracode}
        />
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
        <OrchestratorAccessRow />
      </FormSection>

      <EnvVarsSection />
    </>
  );
}

/** Which Claude Code Dash found, and what to do when it's missing or old. */
function CliStatus({ info }: { info: ClaudeCliInfo | null }) {
  if (!info) return <p className="type-caption">Looking for Claude Code…</p>;
  if (!info.installed) {
    return (
      <Notice icon={<AlertCircle size={14} strokeWidth={1.8} />}>
        Not found. Install it with <Code>npm install -g @anthropic-ai/claude-code</Code>
      </Notice>
    );
  }
  return (
    <div className="grid gap-2">
      <div className="grid gap-0.5">
        <p className="type-body tabular-nums">{cliVersion(info)}</p>
        <p className="type-caption truncate" title={info.path ?? undefined}>
          {info.path}
        </p>
      </div>
      {!info.supported && (
        <Notice icon={<AlertCircle size={14} strokeWidth={1.8} />}>
          Dash needs {info.minVersion} or newer. Run <Code>claude update</Code>
        </Notice>
      )}
    </div>
  );
}

/** The orchestrator switch and, when on, where `dashctl` is, for a session
 *  outside Dash to run. Hidden where the control API doesn't run (win32). */
function OrchestratorAccessRow() {
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
            {copied ? <Check size={14} strokeWidth={1.8} /> : <Copy size={14} strokeWidth={1.8} />}
          </IconButton>
        </div>
      )}
    </SwitchField>
  );
}

function EnvVarsSection() {
  const vars = useSettings((s) => s.customClaudeEnvVars);
  const setVars = useSettings((s) => s.setCustomClaudeEnvVars);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const canAdd = ENV_VAR_NAME.test(newKey.trim());

  function add() {
    const key = newKey.trim();
    if (!ENV_VAR_NAME.test(key)) return;
    setVars({ ...vars, [key]: newValue });
    setNewKey('');
    setNewValue('');
  }

  function remove(key: string) {
    const next = { ...vars };
    delete next[key];
    setVars(next);
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') add();
  };

  return (
    <FormSection
      title="Environment variables"
      hint="Passed to Claude on new tasks."
      action={<TextLink href="https://code.claude.com/docs/en/env-vars">Reference</TextLink>}
    >
      <div className="grid gap-1.5">
        {Object.entries(vars).map(([key, value]) => (
          <EnvVarRow
            key={key}
            name={<Input readOnly value={key} aria-label="Name" mono />}
            value={<Input readOnly value={value} aria-label={`${key} value`} mono />}
            action={
              <IconButton title={`Remove ${key}`} onClick={() => remove(key)}>
                <Trash2 size={14} strokeWidth={1.8} />
              </IconButton>
            }
          />
        ))}
        <EnvVarRow
          name={
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={onEnter}
              placeholder="NAME"
              aria-label="New variable name"
              mono
            />
          }
          value={
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={onEnter}
              placeholder="value"
              aria-label="New variable value"
              mono
            />
          }
          action={
            <IconButton title="Add variable" onClick={add} disabled={!canAdd}>
              <Plus size={14} strokeWidth={1.8} />
            </IconButton>
          }
        />
      </div>
    </FormSection>
  );
}

function EnvVarRow({
  name,
  value,
  action,
}: {
  name: React.ReactNode;
  value: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">{name}</div>
      <span className="type-caption">=</span>
      <div className="min-w-0 flex-1">{value}</div>
      {action}
    </div>
  );
}
