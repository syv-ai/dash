import React, { useState } from 'react';
import { AlertCircle, Check, Download, Loader2 } from 'lucide-react';
import type { RtkDownloadProgress, RtkStatus, RtkTestResult } from '../../../shared/types';
import { useRuntime } from '../../stores/runtimeStore';
import { Button } from '../ui/Button';
import { Code } from '../ui/Code';
import { FormSection, SettingRow } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { SwitchField } from '../ui/SwitchField';
import { TextLink } from '../ui/TextLink';

const RTK_REPO = 'https://github.com/rtk-ai/rtk';

/** Settings → Add-ons: RTK, the only one so far, shown open (no accordion). */
export function AddOnsTab() {
  const status = useRuntime((s) => s.rtkStatus);
  const progress = useRuntime((s) => s.rtkDownloadProgress);
  const enable = useRuntime((s) => s.enableRtk);
  const download = useRuntime((s) => s.downloadRtk);
  const { installing, installLabel } = labelForProgress(progress);

  return (
    <FormSection
      title="RTK"
      description="Compresses common shell-command output before Claude reads it, typically 60–90% fewer tokens per command."
      action={<TextLink href={RTK_REPO}>Learn more</TextLink>}
      divided
    >
      <SettingRow
        label={rtkHeadline(status)}
        hint={<RtkStatusHint status={status} />}
        control={
          status && !status.installed && status.downloadable ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void download()}
              disabled={installing}
            >
              {installing ? (
                <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />
              ) : (
                <Download size={14} strokeWidth={1.8} />
              )}
              {installLabel}
            </Button>
          ) : undefined
        }
      >
        {progress?.phase === 'error' && <p className="text-xs text-state-fail">{progress.error}</p>}
        {progress?.phase === 'done' && (
          <p className="type-caption">Installed {progress.version ?? ''}. Turn it on below.</p>
        )}
      </SettingRow>

      <SwitchField
        label="Use RTK in tasks"
        hint={
          <>
            Applies from each running task&rsquo;s next command. Dash adds the hook to each
            task&rsquo;s local settings and leaves <Code>~/.claude/settings.json</Code> alone;
            don&rsquo;t also run <Code>rtk init -g</Code> or the hook runs twice.
          </>
        }
        checked={status?.installed ? status.enabled : false}
        onCheckedChange={(on) => void enable(on)}
        disabled={!status?.installed}
      />

      {status?.installed && <RtkVerifyRow />}
    </FormSection>
  );
}

function rtkHeadline(status: RtkStatus | null): string {
  if (!status) return 'Checking…';
  if (!status.installed) return 'Not installed';
  return status.enabled ? 'Installed and on' : 'Installed, off';
}

function RtkStatusHint({ status }: { status: RtkStatus | null }) {
  if (!status) return null;
  if (status.installed) {
    return (
      <>
        <span className="tabular-nums">{status.version}</span>,{' '}
        {status.source === 'managed' ? 'managed by Dash' : 'on your PATH'}
        <span className="block truncate" title={status.path}>
          {status.path}
        </span>
      </>
    );
  }
  if (status.downloadable) {
    return 'Dash can fetch the latest release for itself: no sudo, nothing added to your PATH.';
  }
  return (
    <>
      No prebuilt release for this platform; install it from{' '}
      <TextLink href={RTK_REPO}>github.com/rtk-ai/rtk</TextLink>.
    </>
  );
}

function labelForProgress(progress: RtkDownloadProgress | null): {
  installing: boolean;
  installLabel: string;
} {
  if (!progress) return { installing: false, installLabel: 'Install' };
  switch (progress.phase) {
    case 'downloading':
      return { installing: true, installLabel: `Downloading ${progress.percent}%` };
    case 'verifying':
      return { installing: true, installLabel: 'Verifying…' };
    case 'extracting':
      return { installing: true, installLabel: 'Extracting…' };
    case 'done':
    case 'error':
      return { installing: false, installLabel: 'Install' };
    default: {
      const _exhaustive: never = progress;
      void _exhaustive;
      return { installing: false, installLabel: 'Install' };
    }
  }
}

/** Runs `rtk hook claude` on a synthetic command and shows what it would do. */
function RtkVerifyRow() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<RtkTestResult | null>(null);

  async function runTest() {
    setTesting(true);
    setResult(null);
    const resp = await window.electronAPI.rtkTest();
    setTesting(false);
    setResult(
      resp.success && resp.data
        ? resp.data
        : { ok: false, error: resp.error ?? 'unknown IPC error' },
    );
  }

  return (
    <SettingRow
      label="Check it works"
      hint={
        <>
          Runs a sample <Code>git status</Code> through the rtk Dash gives Claude.
        </>
      }
      control={
        <Button size="sm" variant="secondary" onClick={() => void runTest()} disabled={testing}>
          {testing && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
          {testing ? 'Testing…' : 'Test'}
        </Button>
      }
    >
      {result && <RtkTestResultView result={result} />}
    </SettingRow>
  );
}

const fail = <AlertCircle size={14} strokeWidth={1.8} />;
const ok = <Check size={14} strokeWidth={1.8} />;

function RtkTestResultView({ result }: { result: RtkTestResult }) {
  if (!result.ok) {
    return (
      <Notice icon={fail}>
        The test failed: <span className="font-mono break-all">{result.error}</span>
      </Notice>
    );
  }
  const { outcome } = result;
  switch (outcome.kind) {
    case 'blocked':
      return (
        <Notice icon={fail}>
          rtk blocked the command (exit 2).
          {outcome.stderr && <span className="block font-mono break-all">{outcome.stderr}</span>}
        </Notice>
      );
    case 'pass-through':
      return (
        <Notice icon={ok}>
          rtk ran but left this command alone. That&rsquo;s fine: it only rewrites commands on its
          list, such as <Code>git status</Code> or <Code>cargo test</Code>.
        </Notice>
      );
    case 'rewritten': {
      const diff = outcome.execDiff;
      const okDiff = diff?.kind === 'ok' ? diff : null;
      const failedDiff = diff?.kind === 'failed' ? diff : null;
      const saved = okDiff ? okDiff.rawBytes - okDiff.compressedBytes : 0;
      const savedPct =
        okDiff && okDiff.rawBytes > 0 ? Math.round((saved / okDiff.rawBytes) * 100) : 0;
      return (
        <div className="grid gap-2">
          <Notice icon={ok}>
            Working: rtk rewrites <Code>{result.testedCommand}</Code> to{' '}
            <Code>{outcome.rewrittenCommand}</Code>.
            {okDiff && okDiff.rawBytes > 0 && (
              <span className="block tabular-nums">
                {okDiff.rawBytes} → {okDiff.compressedBytes} bytes
                {saved > 0 && ` (−${savedPct}%)`}
                {okDiff.truncated && ', truncated'}
              </span>
            )}
          </Notice>
          {okDiff && (
            <div className="grid grid-cols-2 gap-2">
              <OutputPanel label="Raw" body={okDiff.rawStdout} />
              <OutputPanel label="Through rtk" body={okDiff.compressedStdout} />
            </div>
          )}
          {failedDiff && (
            <Notice icon={fail}>
              Couldn&rsquo;t capture the output: {failedDiff.reason}
              {failedDiff.stderr && (
                <span className="block font-mono whitespace-pre-wrap break-words">
                  {failedDiff.stderr}
                </span>
              )}
            </Notice>
          )}
        </div>
      );
    }
    default: {
      const _exhaustive: never = outcome;
      void _exhaustive;
      return null;
    }
  }
}

function OutputPanel({ label, body }: { label: string; body: string }) {
  return (
    <div className="grid min-w-0 content-start gap-1 rounded-lg bg-well p-2">
      <span className="type-subheading">{label}</span>
      <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap break-words text-ink-2">
        {body.trim() || '(empty)'}
      </pre>
    </div>
  );
}
