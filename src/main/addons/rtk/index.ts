import {
  button,
  code,
  defineAddon,
  progress,
  text,
  type Addon,
  type Block,
} from '@shared/addon-api';
import {
  hookCommand,
  isPlatformDownloadable,
  linkIntoUserPath,
  managedBinDir,
  migrateLegacyBinary,
  resolveBinary,
} from './binary';
import { downloadRtk } from './download';
import { runHookTest } from './hookTest';
import type { RtkDownloadProgress, RtkResolution, RtkTestResult } from './types';

/** What the add-on needs from the outside world; faked in tests. */
export interface RtkDeps {
  migrateLegacyBinary(dataDir: string): void;
  resolveBinary(dataDir: string): Promise<RtkResolution | null>;
  linkIntoUserPath(target: string): void;
  download(dataDir: string, onProgress: (p: RtkDownloadProgress) => void): Promise<RtkResolution>;
  runHookTest(resolved: RtkResolution, managedDir: string | null): Promise<RtkTestResult>;
  isPlatformDownloadable(): boolean;
}

const realDeps: RtkDeps = {
  migrateLegacyBinary,
  resolveBinary,
  linkIntoUserPath,
  download: downloadRtk,
  runHookTest,
  isPlatformDownloadable,
};

const PROGRESS_LABEL: Record<RtkDownloadProgress['phase'], string> = {
  downloading: 'Downloading RTK…',
  verifying: 'Verifying checksum…',
  extracting: 'Installing…',
  done: 'Installed',
  error: 'Install failed',
};

/**
 * RTK (Rust Token Killer, github.com/rtk-ai/rtk): a Claude Code PreToolUse hook
 * on Bash that rewrites commands such as `git status` into `rtk git status`, so
 * their output is compressed before Claude reads it. The add-on's own switch is
 * the on/off: when on and a binary resolves, every task session gets the hook
 * and (for the Dash-managed binary) its directory on PATH.
 */
export function createRtkAddon(deps: RtkDeps = realDeps): Addon {
  return defineAddon({
    id: 'rtk',
    name: 'RTK',
    description:
      'Compresses common shell-command output before Claude reads it — typically 60–90% fewer tokens per command.',
    defaultEnabled: false,

    async activate(ctx) {
      const dataDir = ctx.paths.data;
      deps.migrateLegacyBinary(dataDir);
      let resolved = await deps.resolveBinary(dataDir);
      // Backfill the user-PATH symlink for installs that predate it.
      if (resolved?.source === 'managed') deps.linkIntoUserPath(resolved.path);

      let installing: Promise<void> | null = null;
      let installProgress: RtkDownloadProgress | null = null;
      let testing = false;
      let testResult: RtkTestResult | null = null;

      ctx.session.path(() => (resolved?.source === 'managed' ? [managedBinDir(dataDir)] : []));
      ctx.session.hooks(() =>
        resolved
          ? [{ event: 'PreToolUse', matcher: 'Bash', command: hookCommand(resolved.path) }]
          : [],
      );

      const install = () => {
        installing ??= (async () => {
          try {
            const next = await deps.download(dataDir, (p) => {
              installProgress = p;
              ctx.refresh();
            });
            const wasMissing = !resolved;
            resolved = next;
            testResult = null;
            await ctx.tasks.refreshHooks();
            ctx.notify.toast({
              kind: 'success',
              title: `RTK ${next.version} installed`,
              body: wasMissing
                ? 'New sessions use it; restart running ones to pick it up.'
                : undefined,
            });
          } catch (err) {
            ctx.notify.toast({
              kind: 'error',
              title: "Couldn't install RTK",
              body: err instanceof Error ? err.message : String(err),
            });
          } finally {
            installProgress = null;
            installing = null;
            ctx.refresh();
          }
        })();
        return installing;
      };

      const test = async () => {
        if (!resolved || testing) return;
        testing = true;
        ctx.refresh();
        try {
          testResult = await deps.runHookTest(
            resolved,
            resolved.source === 'managed' ? managedBinDir(dataDir) : null,
          );
        } finally {
          testing = false;
          ctx.refresh();
        }
      };

      return {
        settings: () =>
          settingsBlocks({
            resolved,
            downloadable: deps.isPlatformDownloadable(),
            installProgress,
            installing: installing !== null,
            testing,
            testResult,
          }),
        async onAction(_ref, actionId) {
          if (actionId === 'install') await install();
          else if (actionId === 'test') await test();
        },
      };
    },
  });
}

export interface RtkSettingsState {
  resolved: RtkResolution | null;
  downloadable: boolean;
  installProgress: RtkDownloadProgress | null;
  installing: boolean;
  testing: boolean;
  testResult: RtkTestResult | null;
}

export function settingsBlocks(s: RtkSettingsState): Block[] {
  const blocks: Block[] = [];

  if (s.resolved) {
    const where = s.resolved.source === 'managed' ? 'installed by Dash' : 'from your PATH';
    blocks.push(text(`${s.resolved.version} · ${where}`));
    blocks.push(text(s.resolved.path, 'muted'));
  } else {
    blocks.push(text('Not installed. RTK does nothing until a binary is installed.', 'muted'));
  }

  if (s.installProgress && s.installing) {
    const p = s.installProgress;
    blocks.push(
      progress({
        label: PROGRESS_LABEL[p.phase],
        value: p.phase === 'downloading' ? p.percent / 100 : undefined,
      }),
    );
  }

  // Dash installs and updates only its own copy; a PATH install is the user's.
  if (s.downloadable && s.resolved?.source !== 'path') {
    blocks.push(
      button('install', s.resolved ? 'Update RTK' : 'Install RTK', {
        primary: !s.resolved,
        busy: s.installing,
      }),
    );
  } else if (!s.downloadable && !s.resolved) {
    blocks.push(
      text(
        'No RTK release for this platform. Install rtk yourself, then reopen Settings.',
        'muted',
      ),
    );
  }

  if (s.resolved) {
    blocks.push(button('test', 'Test RTK', { busy: s.testing }));
  }
  if (s.testResult) blocks.push(...testResultBlocks(s.testResult));

  blocks.push(text('Source: github.com/rtk-ai/rtk', 'muted'));
  return blocks;
}

function testResultBlocks(r: RtkTestResult): Block[] {
  if (!r.ok) return [text(`Test failed: ${r.error}`, 'error')];
  const o = r.outcome;
  if (o.kind === 'pass-through') {
    return [text(`RTK left “${r.testedCommand}” unchanged (pass-through).`, 'muted')];
  }
  if (o.kind === 'blocked') {
    return [text(`RTK blocked “${r.testedCommand}”${o.stderr ? `: ${o.stderr}` : ''}`, 'error')];
  }
  const out: Block[] = [
    text(`RTK rewrote “${r.testedCommand}” → “${o.rewrittenCommand}”`, 'success'),
  ];
  const d = o.execDiff;
  if (d?.kind === 'ok') {
    const saved = d.rawBytes > 0 ? Math.round((1 - d.compressedBytes / d.rawBytes) * 100) : 0;
    out.push(
      text(
        `${d.rawBytes} → ${d.compressedBytes} bytes (${saved}% smaller)${d.truncated ? ', output truncated' : ''}`,
      ),
    );
    out.push(code(d.compressedStdout || '(no output)', `${o.rewrittenCommand} output`));
  } else if (d?.kind === 'failed') {
    out.push(text(`Couldn't compare outputs: ${d.reason}`, 'error'));
  }
  return out;
}

export default createRtkAddon();
