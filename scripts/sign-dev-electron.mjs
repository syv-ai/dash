// Re-sign the local Electron dev binary so macOS library validation doesn't
// SIGKILL our locally-built (adhoc-signed) native modules — better-sqlite3,
// node-pty — when running `pnpm dev` / `pnpm test`.
//
// Background: Electron 42's prebuilt binary ships a hardened runtime that
// enforces library validation. Loading an adhoc-signed .node into it gets the
// process killed ("Code Signature Invalid"). The packaged app is unaffected
// (electron-builder signs the final app with Dash's Developer ID and the same
// `disable-library-validation` entitlement used here). Linux has no library
// validation, so this is a no-op there.
//
// We re-sign only the main bundle (no `--deep`) so Electron's helper-app
// signatures/entitlements (renderer JIT, etc.) stay intact. Runs from
// `postinstall`; idempotent and non-fatal.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

if (process.platform !== 'darwin') process.exit(0);

const require = createRequire(import.meta.url);

let electronExe;
try {
  // In a plain-Node context the `electron` module resolves to the binary path.
  electronExe = require('electron');
} catch {
  process.exit(0); // electron not installed yet — nothing to sign
}
if (typeof electronExe !== 'string') process.exit(0);

// .../Electron.app/Contents/MacOS/Electron -> .../Electron.app
const appPath = resolve(dirname(electronExe), '..', '..');
if (!appPath.endsWith('.app') || !existsSync(appPath)) process.exit(0);

const entitlements = resolve(import.meta.dirname, '..', 'build', 'entitlements.mac.plist');
if (!existsSync(entitlements)) process.exit(0);

try {
  execFileSync('codesign', ['--force', '--sign', '-', '--entitlements', entitlements, appPath], {
    stdio: 'ignore',
  });
  console.log('[sign-dev-electron] re-signed dev Electron with disable-library-validation');
} catch (err) {
  console.warn(
    '[sign-dev-electron] could not re-sign dev Electron (non-fatal); `pnpm dev`/`pnpm test` may',
    'SIGKILL on native modules until you run: codesign --force --sign - --entitlements',
    `build/entitlements.mac.plist "${appPath}"\n  reason:`,
    err?.message || err,
  );
}
