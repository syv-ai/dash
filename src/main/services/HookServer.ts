import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { app, BrowserWindow, Notification } from 'electron';
import { eq } from 'drizzle-orm';
import { activityMonitor } from './ActivityMonitor';
import { contextUsageService } from './ContextUsageService';
import { tokenStatsService } from './TokenStatsService';
import {
  isSelfStartedPrompt,
  isSubagentHook,
  LIMIT_OVER_NOTIFICATIONS,
  NOTIFICATION_WAIT_KINDS,
  runningSubagentIds,
  sessionPermissionMode,
  statusLineTaskId,
  stopFailureError,
  stopFailureText,
  subagentId,
  WAIT_NOTIFICATIONS,
  type WaitKind,
} from './hookPayload';
import { logLimitEvent } from './limitEventLog';
import { setTaskInbox } from './taskInbox';
import { usageLimitService } from './UsageLimitService';
import { limitNotice } from './usageLimitState';
import { toastRenderer } from '../utils/toast';
import { noteScratchpad } from './ScratchpadService';
import { claudeConfigDir } from '../utils/claudePaths';
import { checkShape } from '../claudeContract/check';
import { claudeVersionFor, noteTaskClaudeVersion } from '../claudeContract/claudeVersions';
import { reportFindings } from '../claudeContract/driftReporter';
import { checkHookPayload, type NotificationType } from '../claudeContract/hookSchemas';
import { statusLineSchema } from '../claudeContract/statusLineSchema';
import { getDb } from '../db/client';
import { tasks } from '../db/schema';
import type { UsageLimitHit } from '@shared/types';

/**
 * In-process event bus for hook events that other main-side services may need
 * to observe. Each fires before ActivityMonitor hears the same hook, so a
 * listener knows the cause before the state changes.
 *
 * Events:
 *  - 'permission-prompt'  { ptyId }  — Notification(permission_prompt) fired
 *  - 'wait-opened'        { ptyId, kind }  — a hook asked the user something
 *  - 'tool-called'        { ptyId }  — a PreToolUse, the main agent's or a subagent's
 *  - 'subagent-started'   { ptyId }  — a SubagentStart
 *
 * The last three feed analytics (activityTelemetry's `HookFacts`).
 */
export const hookEvents = new EventEmitter();

const noteWait = (ptyId: string, kind: WaitKind) => hookEvents.emit('wait-opened', { ptyId, kind });

/**
 * The session's inbox from a hook's `X-Dash-Messaging-*` headers
 * (ptyHookSettings INBOX_HEADERS_HEREDOC), with the transcript the payload names;
 * null when the session sent none. The token is never logged.
 */
export function inboxFromHeaders(
  headers: http.IncomingHttpHeaders,
  payload: Record<string, unknown>,
): { socket: string; token: string; transcriptPath: string | null } | null {
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');
  const socket = one(headers['x-dash-messaging-socket']);
  const token = one(headers['x-dash-messaging-token']);
  if (!socket || !token || !path.isAbsolute(socket)) return null;
  // Only a transcript under Claude Code's own projects folder is read back later.
  const projects = path.join(claudeConfigDir(), 'projects') + path.sep;
  const t = payload.transcript_path;
  const transcriptPath =
    typeof t === 'string' && t.endsWith('.jsonl') && path.resolve(t).startsWith(projects)
      ? path.resolve(t)
      : null;
  return { socket, token, transcriptPath };
}

/** Maximum JSON body size for hook payloads (64KB). */
const MAX_HOOK_BODY_BYTES = 65_536;

/** A PreToolUse or PermissionRequest payload's tool: its name and input object. */
function toolOf(payload: Record<string, unknown>): {
  toolName: string;
  toolInput: Record<string, unknown> | undefined;
} {
  return {
    toolName: typeof payload.tool_name === 'string' ? payload.tool_name : 'unknown',
    toolInput:
      payload.tool_input && typeof payload.tool_input === 'object'
        ? (payload.tool_input as Record<string, unknown>)
        : undefined,
  };
}

/**
 * File the hook commands read the HookServer port from. The port changes on
 * every Dash launch while task sessions live on under Claude Code's supervisor
 * (which also freezes the dispatch-time env into the job), so the port cannot
 * travel in the environment. Written by start(), removed by stop(); a session
 * running while Dash is closed finds no file and its hooks no-op.
 */
export function getHookPortFilePath(): string {
  try {
    return path.join(app.getPath('userData'), 'hook-port');
  } catch {
    // No `app` (unit tests) — keep the shape, point at a harmless location.
    return path.join(os.tmpdir(), 'dash-hook-port');
  }
}

/**
 * Check a hook or statusLine body against Claude Code's contract and report
 * any drift (claudeContract/). After the response path, on the next turn of
 * the event loop, and never throwing: it only watches.
 */
function observeContract(url: string | undefined, payload: Record<string, unknown>): void {
  setImmediate(() => {
    try {
      const { pathname, searchParams } = new URL(url ?? '', 'http://127.0.0.1');
      const ptyId = searchParams.get('ptyId') ?? undefined;
      if (pathname === '/hook/context') {
        reportFindings(
          'statusline',
          checkShape(statusLineSchema, payload),
          claudeVersionFor(ptyId),
        );
        return;
      }
      const { source, findings } = checkHookPayload(payload, pathname);
      reportFindings(source, findings, claudeVersionFor(ptyId));
    } catch (err) {
      console.warn('[HookServer] contract check failed:', err);
    }
  });
}

/** Every hook payload names the session's permission mode: keep the task's
 *  current one (ActivityMonitor.notePermissionMode). */
function notePermissionMode(url: string | undefined, payload: Record<string, unknown>): void {
  const mode = sessionPermissionMode(payload);
  if (!mode) return;
  const ptyId = new URL(url ?? '', 'http://127.0.0.1').searchParams.get('ptyId');
  if (ptyId) activityMonitor.notePermissionMode(ptyId, mode);
}

class HookServerImpl {
  private server: http.Server | null = null;
  private _port: number = 0;
  private _desktopNotificationEnabled = false;
  // Permissive default until setPtyValidator is called during boot
  private _hasPty: (id: string) => boolean = () => true;

  get port(): number {
    return this._port;
  }

  setDesktopNotification(opts: { enabled: boolean }): void {
    this._desktopNotificationEnabled = opts.enabled;
  }

  setPtyValidator(fn: (id: string) => boolean): void {
    this._hasPty = fn;
  }

  private showDesktopNotification(ptyId: string, body?: string): void {
    if (!this._desktopNotificationEnabled) return;

    // Skip if the app window is focused — user is already looking at it
    const win = BrowserWindow.getAllWindows()[0];
    if (win && win.isFocused()) return;

    try {
      if (!body) {
        body = 'A task finished';
        try {
          const db = getDb();
          const task = db.select({ name: tasks.name }).from(tasks).where(eq(tasks.id, ptyId)).get();
          if (task?.name) {
            body = `${task.name} finished`;
          }
        } catch (err) {
          console.warn('[HookServer] DB lookup for notification body failed:', err);
        }
      }
      const n = new Notification({
        title: 'Dash',
        body,
      });
      n.on('click', () => {
        if (win) {
          if (win.isMinimized()) win.restore();
          win.focus();
          win.webContents.send('app:focusTask', {
            taskId: ptyId,
            projectId: this.getTaskProjectId(ptyId),
          });
        }
      });
      n.show();
    } catch (err) {
      console.error('[HookServer] Failed to show notification:', err);
    }
  }

  private getTaskProjectId(ptyId: string): string | undefined {
    try {
      const db = getDb();
      const task = db
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, ptyId))
        .get();
      return task?.projectId;
    } catch (err) {
      console.warn('[HookServer] DB lookup for task project failed:', err);
      return undefined;
    }
  }

  private getTaskIdAtPath(dir: string): string | undefined {
    try {
      const db = getDb();
      return db.select({ id: tasks.id }).from(tasks).where(eq(tasks.path, dir)).get()?.id;
    } catch (err) {
      console.warn('[HookServer] DB lookup for task path failed:', err);
      return undefined;
    }
  }

  private getTaskName(ptyId: string): string {
    try {
      const db = getDb();
      const task = db.select({ name: tasks.name }).from(tasks).where(eq(tasks.id, ptyId)).get();
      return task?.name || 'A task';
    } catch (err) {
      console.warn('[HookServer] DB lookup for task name failed:', err);
      return 'A task';
    }
  }

  /** The account hit a usage limit: a toast when Dash has focus, else a desktop notification. */
  private notifyLimit(ptyId: string, hit: UsageLimitHit): void {
    // The renderer's locale, so the toast's clock reads as the usage ring's.
    const { title, body } = limitNotice(hit, Date.now(), { locale: app.getLocale() });
    const win = BrowserWindow.getAllWindows()[0];
    if (win?.isFocused()) {
      toastRenderer({ kind: 'warning', title, description: body, key: 'usage-limit' });
    } else {
      this.showDesktopNotification(ptyId, `${title}. ${body}`);
    }
  }

  /** Keep a StopFailure or quota Notification as evidence (limitEventLog). */
  private logLimitEvent(ptyId: string, payload: Record<string, unknown>): void {
    logLimitEvent({
      event: typeof payload.hook_event_name === 'string' ? payload.hook_event_name : 'unknown',
      payload,
      claudeVersion: claudeVersionFor(ptyId),
      rateLimits: contextUsageService.getAllStatusLine()[ptyId]?.rateLimits,
    });
  }

  /** Read and parse a JSON POST body, enforcing a size limit. */
  private readJsonBody(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    maxBytes: number,
    callback: (data: Record<string, unknown>) => void,
  ): void {
    let body = '';
    let overflow = false;
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > maxBytes) {
        overflow = true;
        req.destroy();
      }
    });
    req.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(400);
        res.end();
      }
    });
    req.on('end', () => {
      if (res.headersSent) return;
      if (overflow) {
        res.writeHead(413);
        res.end('payload too large');
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        console.error('[HookServer] Failed to parse JSON body:', err);
        res.writeHead(400);
        res.end('bad request');
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        res.writeHead(400);
        res.end('expected JSON object');
        return;
      }
      observeContract(req.url, parsed);
      notePermissionMode(req.url, parsed);
      try {
        callback(parsed);
      } catch (err) {
        console.error('[HookServer] Callback error:', err);
        res.writeHead(500);
        res.end();
      }
    });
  }

  async start(): Promise<number> {
    if (this.server) return this._port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        try {
          if (req.method !== 'POST') {
            res.writeHead(405);
            res.end();
            return;
          }

          const url = new URL(req.url || '', `http://127.0.0.1:${this._port}`);
          const ptyId = url.searchParams.get('ptyId');

          if (!ptyId) {
            res.writeHead(400);
            res.end('missing ptyId');
            return;
          }

          if (!this._hasPty(ptyId)) {
            res.writeHead(404);
            res.end();
            return;
          }

          const pathname = url.pathname;

          // Hooks are POST — drain the JSON body before responding.
          // IMPORTANT: Response must have an empty body (not 'ok') to avoid
          // injecting text into Claude's conversation context.

          if (pathname === '/hook/stop') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              // Background subagents still running keep the task working;
              // "finished" waits for the last of them.
              const over = activityMonitor.endTurn(ptyId, runningSubagentIds(payload));
              // A turn got through: the account isn't at its limit.
              usageLimitService.noteLimitOver();
              if (over) this.showDesktopNotification(ptyId);
              // A turn just ended, so the transcript has new usage to total.
              void tokenStatsService.recomputeForTask(ptyId);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/busy') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              const inbox = inboxFromHeaders(req.headers, payload);
              if (inbox) setTaskInbox(ptyId, inbox);
              activityMonitor.setBusy(ptyId, { selfStarted: isSelfStartedPrompt(payload) });
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/notification') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              const notificationType =
                typeof payload.notification_type === 'string' ? payload.notification_type : '';
              const message = typeof payload.message === 'string' ? payload.message : undefined;
              const effect = WAIT_NOTIFICATIONS[notificationType as NotificationType];
              if (notificationType.startsWith('quota_')) this.logLimitEvent(ptyId, payload);
              // Before the task's own effect: clearing puts the limit's red tasks back.
              if (LIMIT_OVER_NOTIFICATIONS.has(notificationType as NotificationType)) {
                usageLimitService.noteLimitOver();
              }

              // These notifications come ~6 s into a wait, and only when the
              // user seems away: the state may already be set by the instant
              // PermissionRequest/Elicitation hooks, so they mostly alert.
              if (effect === 'needs') {
                const kind = NOTIFICATION_WAIT_KINDS[notificationType as NotificationType];
                if (kind) noteWait(ptyId, kind);
                activityMonitor.setWaitingForPermission(ptyId);
                if (notificationType === 'permission_prompt') {
                  hookEvents.emit('permission-prompt', { ptyId });
                }
                const taskName = this.getTaskName(ptyId);
                this.showDesktopNotification(
                  ptyId,
                  message ? `${taskName}: ${message}` : `${taskName} needs you`,
                );
              } else if (effect === 'answered') {
                activityMonitor.resumeFromWait(ptyId);
              } else if (effect === 'idle') {
                activityMonitor.setIdle(ptyId);
                this.showDesktopNotification(ptyId);
              } else if (effect === 'resumed') {
                // Claude Code continues the turn itself; no UserPromptSubmit says so.
                activityMonitor.setBusy(ptyId, { selfStarted: true });
              }

              res.writeHead(200);
              res.end();
            });
            return;
          }

          // A permission prompt opened (H3). The desktop alert waits for
          // the permission_prompt notification: Claude Code sends it only
          // once the user seems away.
          if (pathname === '/hook/permission-request') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              noteWait(ptyId, 'permission');
              // The call it asks about, so the control API can name it.
              activityMonitor.setWaitingForPermission(ptyId, toolOf(payload));
              res.writeHead(200);
              res.end();
            });
            return;
          }

          // An MCP server asks the user for input (H2).
          if (pathname === '/hook/elicitation') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, () => {
              noteWait(ptyId, 'elicitation');
              activityMonitor.setWaitingForPermission(ptyId);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/elicitation-result') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, () => {
              activityMonitor.resumeFromWait(ptyId);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          // StatusLine data (context usage) — uses type:"command" + curl, not type:"http"
          if (pathname === '/hook/context') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (data) => {
              // The statusLine is one slot, and the root task's wins inside a
              // worktree under it: route by the session's own folder.
              const owner = statusLineTaskId(ptyId, data, (dir) => this.getTaskIdAtPath(dir));
              if (owner === ptyId || this._hasPty(owner)) {
                contextUsageService.updateFromStatusLine(owner, data);
                noteScratchpad(owner, data);
                // The one payload that names the session's Claude Code version.
                if (typeof data.version === 'string') noteTaskClaudeVersion(owner, data.version);
              }
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/tool-start') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              const { toolName, toolInput } = toolOf(payload);
              hookEvents.emit('tool-called', { ptyId });
              // AskUserQuestion is "user attention required", not "Claude is
              // working" — mirror the Notification(permission_prompt) path.
              if (toolName === 'AskUserQuestion') {
                noteWait(ptyId, 'question');
                activityMonitor.setWaitingForPermission(ptyId, { toolName, toolInput });
                const taskName = this.getTaskName(ptyId);
                this.showDesktopNotification(ptyId, `${taskName} is asking a question`);
              } else if (isSubagentHook(payload)) {
                activityMonitor.noteSubagentHook(ptyId);
              } else {
                activityMonitor.setToolStart(ptyId, toolName, toolInput);
              }
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/tool-end') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';
              if (toolName === 'AskUserQuestion') {
                // User answered — back to busy (Claude will resume working).
                activityMonitor.setBusy(ptyId);
              } else if (isSubagentHook(payload)) {
                activityMonitor.noteSubagentHook(ptyId);
              } else {
                activityMonitor.setToolEnd(ptyId);
              }
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/stop-failure') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              this.logLimitEvent(ptyId, payload);
              const error = stopFailureError(payload);
              console.error(`[HookServer] StopFailure for ptyId=${ptyId} type=${error.type}`);
              activityMonitor.setError(ptyId, error);

              // The limit is the account's: one notice per hit, not one per task.
              if (error.type === 'rate_limit') {
                const hit = usageLimitService.noteRateLimited(ptyId, stopFailureText(payload));
                if (hit) this.notifyLimit(ptyId, hit);
              }

              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/subagent-start') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              const agentId = subagentId(payload);
              hookEvents.emit('subagent-started', { ptyId });
              if (agentId) activityMonitor.subagentStart(ptyId, agentId);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/subagent-stop') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              const agentId = subagentId(payload);
              if (agentId) {
                activityMonitor.subagentStop(ptyId, agentId, runningSubagentIds(payload));
              }
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/compact-start') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              if (!isSubagentHook(payload)) activityMonitor.setCompacting(ptyId, true);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/compact-end') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              if (!isSubagentHook(payload)) activityMonitor.setCompacting(ptyId, false);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/session-end') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, () => {
              activityMonitor.setIdle(ptyId);
              void tokenStatsService.recomputeForTask(ptyId);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          // SessionStart, every source: only reports the session's inbox
          // (taskInbox.ts); activity is left alone.
          if (pathname === '/hook/inbox') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              const inbox = inboxFromHeaders(req.headers, payload);
              if (inbox) setTaskInbox(ptyId, inbox);
              // The first payload of a session to name its scratchpad.
              noteScratchpad(ptyId, payload);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/session-start') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, () => {
              // Settings only register this hook for the `clear` and `compact`
              // matchers, so reaching here means the session was reset and any
              // prior busy state is stale: the main turn ends. Background
              // subagents survive both, so they still count.
              activityMonitor.endTurn(ptyId);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          res.writeHead(404);
          res.end();
        } catch (err) {
          console.error('[HookServer] Request handler error:', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        }
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this._port = addr.port;
          this.writePortFile(this._port);
          console.error(`[HookServer] Listening on 127.0.0.1:${this._port}`);
          resolve(this._port);
        } else {
          reject(new Error('Failed to get hook server address'));
        }
      });

      this.server.on('error', reject);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this._port = 0;
    }
    this.removePortFile();
  }

  private writePortFile(port: number): void {
    try {
      const file = getHookPortFilePath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${port}\n`);
    } catch (err) {
      console.error('[HookServer] Failed to write the hook port file:', err);
    }
  }

  private removePortFile(): void {
    try {
      fs.rmSync(getHookPortFilePath(), { force: true });
    } catch {
      // Best effort — a stale file is overwritten on the next start.
    }
  }
}

export const hookServer = new HookServerImpl();
