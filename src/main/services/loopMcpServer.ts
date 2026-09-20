import type { IncomingMessage, ServerResponse } from 'http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loopController } from './LoopController';
import { LoopService } from './LoopService';

/**
 * The loop MCP bridge (docs/agentic-loops-plan.md item 7): the tool surface the
 * MANAGER drives to observe and steer its worker. Hung off the existing
 * HookServer as a per-task, STATELESS streamable-HTTP MCP server — a fresh
 * McpServer + transport per request (no session state), which Claude Code's MCP
 * client supports and which keeps every tool call reading the LOOP's current
 * cwd/level rather than a snapshot from connect time.
 *
 * Tools drive Dash's scheduler (LoopController) and durable spine (LoopService)
 * IN-PROCESS — no HTTP hop back to ourselves. Control tools (pause/resume/kill)
 * are gated by the loop level: L1 keeps them human-only (the manager must
 * escalate instead), matching the phased-trust model.
 */

const CallText = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const CallError = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

const NOT_RUNNING = 'This loop is not running — nothing to act on.';
const L1_HUMAN_ONLY =
  'This is an L1 (report-only) loop: pause/resume/kill are human-only. Use loop_escalate to raise it for a human instead.';

/** Build a fresh MCP server whose tools are bound to one loop task. */
export function buildLoopMcpServer(taskId: string): McpServer {
  const server = new McpServer({ name: 'dash-loop', version: '1.0.0' });

  // Read live each call so tools reflect the loop's current cwd/level, and
  // return NOT_RUNNING once the loop has been stopped and forgotten.
  const ctx = () => loopController.getContext(taskId);

  server.registerTool(
    'loop_status',
    {
      title: 'Loop status',
      description: 'Current loop state: run state, iteration vs max, and token spend vs budget.',
    },
    async () => {
      const status = loopController.getStatus(taskId);
      return status ? CallText(JSON.stringify(status, null, 2)) : CallError(NOT_RUNNING);
    },
  );

  server.registerTool(
    'loop_get_state',
    {
      title: 'Read STATE.md',
      description: 'Read the loop STATE.md (durable priorities/watchlist).',
    },
    async () => {
      const c = ctx();
      if (!c) return CallError(NOT_RUNNING);
      return CallText(await LoopService.readState(c.cwd));
    },
  );

  server.registerTool(
    'loop_update_state',
    {
      title: 'Write STATE.md',
      description: 'Replace STATE.md with the given content (keep it current and concise).',
      inputSchema: { content: z.string() },
    },
    async ({ content }) => {
      const c = ctx();
      if (!c) return CallError(NOT_RUNNING);
      await LoopService.writeState(c.cwd, content);
      return CallText('STATE.md updated.');
    },
  );

  server.registerTool(
    'loop_steer',
    {
      title: 'Steer the worker',
      description:
        'Append guidance the NEXT fresh worker iteration will read (manager-notes.md). This is how you steer a worker that resets context each pass.',
      inputSchema: { message: z.string() },
    },
    async ({ message }) => {
      const c = ctx();
      if (!c) return CallError(NOT_RUNNING);
      await LoopService.appendManagerNotes(c.cwd, `- ${message}`);
      return CallText('Steering note added for the next iteration.');
    },
  );

  server.registerTool(
    'loop_append_run_log',
    {
      title: 'Append run log',
      description: 'Append one observability line to loop-run-log.md.',
      inputSchema: { entry: z.string() },
    },
    async ({ entry }) => {
      const c = ctx();
      if (!c) return CallError(NOT_RUNNING);
      await LoopService.appendRunLog(c.cwd, entry);
      return CallText('Logged.');
    },
  );

  server.registerTool(
    'loop_escalate',
    {
      title: 'Escalate to human',
      description:
        'Raise something risky/ambiguous for a human: records it in the run log and leaves a NEEDS HUMAN note for the next iteration.',
      inputSchema: { summary: z.string() },
    },
    async ({ summary }) => {
      const c = ctx();
      if (!c) return CallError(NOT_RUNNING);
      await LoopService.appendRunLog(c.cwd, `ESCALATION: ${summary}`);
      await LoopService.appendManagerNotes(c.cwd, `- NEEDS HUMAN: ${summary}`);
      return CallText('Escalated — recorded for the human and the next iteration.');
    },
  );

  server.registerTool(
    'loop_pause',
    {
      title: 'Pause the loop',
      description: 'Halt the iteration loop after the current pass (L2+).',
    },
    async () => {
      const c = ctx();
      if (!c) return CallError(NOT_RUNNING);
      if (c.level === 'L1') return CallError(L1_HUMAN_ONLY);
      loopController.pause(taskId);
      return CallText('Loop paused.');
    },
  );

  server.registerTool(
    'loop_resume',
    { title: 'Resume the loop', description: 'Resume a paused loop (L2+).' },
    async () => {
      const c = ctx();
      if (!c) return CallError(NOT_RUNNING);
      if (c.level === 'L1') return CallError(L1_HUMAN_ONLY);
      await loopController.resume(taskId);
      return CallText('Loop resumed.');
    },
  );

  server.registerTool(
    'loop_kill',
    { title: 'Stop the loop', description: 'Stop the loop and tear down the worker (L2+).' },
    async () => {
      const c = ctx();
      if (!c) return CallError(NOT_RUNNING);
      if (c.level === 'L1') return CallError(L1_HUMAN_ONLY);
      await loopController.stop(taskId);
      return CallText('Loop stopped.');
    },
  );

  return server;
}

/**
 * Serve one MCP request for `taskId`. Stateless: a fresh server + transport per
 * request, closed when the response ends. Called by HookServer for `/mcp/loop`.
 */
export async function handleLoopMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string,
): Promise<void> {
  const server = buildLoopMcpServer(taskId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('[loopMcpServer] request failed', err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end();
    }
  }
}
