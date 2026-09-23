// RTK add-on types. These stay inside the add-on: the renderer only sees the
// blocks the add-on builds from them.

export type RtkSource = 'path' | 'managed';

export interface RtkResolution {
  path: string;
  source: RtkSource;
  version: string;
}

export type RtkDownloadProgress =
  | { phase: 'downloading'; percent: number }
  | { phase: 'verifying' }
  | { phase: 'extracting' }
  | { phase: 'done'; version: string }
  | { phase: 'error'; error: string };

export type RtkExecDiff =
  | {
      kind: 'ok';
      /** Stdout of the raw tested command, capped. */
      rawStdout: string;
      /** Stdout of the rtk-rewritten command, capped. */
      compressedStdout: string;
      /** Untruncated byte counts, for honest savings math. */
      rawBytes: number;
      compressedBytes: number;
      /** True when stdout hit the runShell cap; byte counts then reflect the truncated buffer. */
      truncated: boolean;
    }
  | {
      /** Diff capture itself failed — distinct from "rtk chose pass-through". */
      kind: 'failed';
      /** `setup` (mkdtemp/git init), `raw`, `rewritten`, or `unknown`. */
      stage: 'setup' | 'raw' | 'rewritten' | 'unknown';
      exitCode?: number;
      stderr?: string;
      reason: string;
    };

export type RtkTestResult =
  | { ok: false; testedCommand?: string; error: string }
  | {
      ok: true;
      testedCommand: string;
      rawOutput: string;
      outcome: RtkTestOutcome;
    };

export type RtkTestOutcome =
  // rtk ran cleanly and chose pass-through (no rewrite for this command).
  | { kind: 'pass-through' }
  // rtk used exit 2 to block the tool call. Distinct from a failure.
  | { kind: 'blocked'; stderr: string }
  // rtk emitted a rewrite; execDiff is best-effort visualization.
  | { kind: 'rewritten'; rewrittenCommand: string; execDiff?: RtkExecDiff };
