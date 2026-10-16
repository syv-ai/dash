import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { callerString, type Caller } from './callers';
import { controlPaths, type ControlPaths } from './paths';

/**
 * Caller tokens are HMACs of one secret, so nothing per task is stored and a
 * session frozen by the supervisor keeps a valid token across Dash restarts.
 * Revocation is not here: a task token only works while the task's
 * `dash_access` is on (scope.ts).
 */

let paths: ControlPaths | null = null;
let secret: Buffer | null = null;

/** Write `content` to `file` with mode 0600 via tmp + rename, so readers never see a partial file. */
export function writePrivateFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function loadOrCreateSecret(file: string): Buffer {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return Buffer.from(existing, 'hex');
  } catch {
    // Absent: create below.
  }
  const fresh = crypto.randomBytes(32);
  writePrivateFile(file, fresh.toString('hex'));
  return fresh;
}

/** Point the token store at a userData dir, creating its secret if absent. */
export function initTokens(userDataDir: string): void {
  paths = controlPaths(userDataDir);
  secret = loadOrCreateSecret(paths.secret);
}

/** The control paths once `initTokens` ran (the control API started), else null. */
export function initializedPaths(): ControlPaths | null {
  return paths;
}

function requireInit(): { paths: ControlPaths; secret: Buffer } {
  if (!paths || !secret) throw new Error('control tokens used before initTokens()');
  return { paths, secret };
}

/** Hex HMAC-SHA256 of the caller string under the secret. */
export function tokenFor(caller: Caller): string {
  return crypto
    .createHmac('sha256', requireInit().secret)
    .update(callerString(caller))
    .digest('hex');
}

/** Constant-time check that `token` was minted for `caller`. */
export function verify(token: string, caller: Caller): boolean {
  const expected = Buffer.from(tokenFor(caller), 'utf8');
  const given = Buffer.from(token, 'utf8');
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

/** Write (enabled) or remove the orchestrator-token file the `claude mcp add` setup reads. */
export function setOrchestratorFile(enabled: boolean): void {
  const { paths: p } = requireInit();
  if (enabled) {
    writePrivateFile(p.orchestratorToken, `${tokenFor({ kind: 'orchestrator' })}\n`);
  } else {
    fs.rmSync(p.orchestratorToken, { force: true });
  }
}
