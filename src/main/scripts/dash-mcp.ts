/**
 * `dash-mcp`: the stdio MCP front door to Dash's control API.
 *
 * Bundled by esbuild into `dist/main/main/scripts/dash-mcp.js` and run by the
 * `control/dash-mcp` launcher under Electron's Node. It must stay free of
 * electron and of path aliases: it imports only the pure control modules.
 *
 * It finds the API through the `control-port` file at call time, the way
 * hooks find `hook-port`, so it survives Dash restarts and port changes.
 * The tool list mirrors `GET /v1/capabilities`; nothing is hardcoded here.
 */
import * as fs from 'fs';
import * as http from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { callerString, parseCaller } from '../control/callers';
import { DASH_MCP_SERVER, mcpToolName } from '../control/naming';
import { controlPaths } from '../control/paths';

const NOT_RUNNING = 'Dash is not running. Open Dash and try again.';
const ORCHESTRATOR_OFF = 'orchestrator access is off in Dash settings';
/** How often to look for Dash while it has no tools to offer. Env override is for tests. */
const POLL_MS = Number(process.env.DASH_MCP_POLL_MS) || 5000;
// How often to check Dash's tools against what the client last listed.
const WATCH_MS = Number(process.env.DASH_MCP_WATCH_MS) || 15_000;
/** Listing is quick; calls may block (tasks.wait), so they get no timeout. */
const LIST_TIMEOUT_MS = 5000;

const userDataDir = process.env.DASH_USER_DATA_DIR;
if (!userDataDir) {
  process.stderr.write(
    'dash-mcp: DASH_USER_DATA_DIR is not set; run it through the Dash launcher\n',
  );
  process.exit(1);
}
const paths = controlPaths(userDataDir);

/** A failure to show the agent as-is (the tool result text). */
class ShimError extends Error {}

interface Capability {
  name: string;
  summary: string;
  inputSchema: unknown;
}

/** Caller and token: from env for a task (its mcp-config sets both), else the orchestrator's file. */
function credentials(): { caller: string; token: string } {
  const envCaller = process.env.DASH_CALLER;
  const envToken = process.env.DASH_TOKEN;
  if (envCaller && envToken) {
    const caller = parseCaller(envCaller);
    if (!caller) throw new ShimError(`dash-mcp: invalid DASH_CALLER ${JSON.stringify(envCaller)}`);
    return { caller: callerString(caller), token: envToken };
  }
  let token = '';
  try {
    token = fs.readFileSync(paths.orchestratorToken, 'utf8').trim();
  } catch {
    // Absent while orchestrator access is off.
  }
  if (!token) throw new ShimError(ORCHESTRATOR_OFF);
  return { caller: 'orchestrator', token };
}

function readPort(): number {
  let raw: string;
  try {
    raw = fs.readFileSync(paths.port, 'utf8');
  } catch {
    throw new ShimError(NOT_RUNNING);
  }
  const port = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new ShimError(NOT_RUNNING);
  return port;
}

/** One request to the control API; resolves with any HTTP status, rejects with ShimError. */
function request(
  method: 'GET' | 'POST',
  pathname: string,
  body: unknown,
  timeoutMs?: number,
): Promise<{ status: number; json: unknown }> {
  const port = readPort();
  const { caller, token } = credentials();
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        // No keep-alive socket may outlive the call, so EOF on stdin exits.
        agent: false,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Dash-Caller': caller,
          ...(payload !== undefined
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', () => reject(new ShimError(NOT_RUNNING)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            // Non-JSON body: the status alone describes it.
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    if (timeoutMs) {
      req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    }
    // Refused, reset or timed out: a stale port file from a crashed Dash looks the same.
    req.on('error', () => reject(new ShimError(NOT_RUNNING)));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function errorMessage(status: number, json: unknown): string {
  const body = (json ?? {}) as { error?: unknown; details?: unknown };
  const message = typeof body.error === 'string' ? body.error : `Dash answered HTTP ${status}`;
  if (status === 400 && Array.isArray(body.details) && body.details.length > 0) {
    const issues = body.details.map((issue: { path?: unknown[]; message?: unknown }) => {
      const at =
        Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : '(input)';
      return `${at}: ${String(issue.message ?? 'invalid')}`;
    });
    return `${message}\nInvalid input: ${issues.join('; ')}`;
  }
  return message;
}

function isObjectSchema(schema: unknown): schema is Tool['inputSchema'] {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    (schema as { type?: unknown }).type === 'object'
  );
}

/** Tool name → capability name, from the last successful list. Never reverse-derived. */
let toolToCapability = new Map<string, string>();

async function fetchTools(): Promise<Tool[]> {
  const { status, json } = await request('GET', '/v1/capabilities', undefined, LIST_TIMEOUT_MS);
  if (status !== 200) throw new ShimError(errorMessage(status, json));
  const capabilities = (json as { capabilities?: Capability[] } | null)?.capabilities ?? [];
  const map = new Map<string, string>();
  const tools: Tool[] = capabilities.map((cap) => {
    const name = mcpToolName(cap.name);
    map.set(name, cap.name);
    return {
      name,
      description: cap.summary,
      inputSchema: isObjectSchema(cap.inputSchema) ? cap.inputSchema : { type: 'object' },
    };
  });
  toolToCapability = map;
  return tools;
}

const server = new Server(
  { name: DASH_MCP_SERVER, version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } },
);

/**
 * While Dash can't list tools (not running, or orchestrator access off), look
 * for it every POLL_MS and tell the client to re-list once it answers.
 */
let pollTimer: NodeJS.Timeout | null = null;

function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    fetchTools().then(
      (tools) => {
        if (!pollTimer) return;
        clearInterval(pollTimer);
        pollTimer = null;
        if (tools.length === 0) return;
        server.sendToolListChanged().catch(() => {
          // Client gone; nothing to tell.
        });
      },
      () => {
        // Still unavailable; try again next tick.
      },
    );
  }, POLL_MS);
  // Polling must never keep the process alive after stdin closes.
  pollTimer.unref();
}

/**
 * The client caches the tool list, and this process outlives a Dash restart
 * (it belongs to the session), so a Dash that comes back with new or changed
 * tools would go unseen. Once the client has a list, check Dash's every
 * WATCH_MS and tell the client to re-list when it differs.
 */
let listedCatalog: string | null = null;
let watchTimer: NodeJS.Timeout | null = null;
const catalogOf = (tools: Tool[]) => JSON.stringify(tools);

function startWatching(): void {
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    fetchTools().then(
      (tools) => {
        if (listedCatalog === null || catalogOf(tools) === listedCatalog) return;
        listedCatalog = null; // told once; the client's re-list sets it again
        server.sendToolListChanged().catch(() => {
          // Client gone; nothing to tell.
        });
      },
      () => {
        // Dash is restarting or gone; check again next tick.
      },
    );
  }, WATCH_MS);
  watchTimer.unref();
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    const tools = await fetchTools();
    if (tools.length === 0) startPolling();
    else {
      listedCatalog = catalogOf(tools);
      startWatching();
    }
    return { tools };
  } catch {
    toolToCapability = new Map();
    startPolling();
    return { tools: [] };
  }
});

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
  const tool = req.params.name;
  try {
    let capability = toolToCapability.get(tool);
    if (!capability) {
      // The client may call from a list it cached across a Dash restart.
      await fetchTools();
      capability = toolToCapability.get(tool);
    }
    if (!capability) return errorResult(`Unknown Dash tool ${tool}`);
    const { status, json } = await request('POST', '/v1/call', {
      name: capability,
      input: req.params.arguments ?? {},
    });
    if (status !== 200) return errorResult(errorMessage(status, json));
    const result = (json as { result?: unknown } | null)?.result;
    return { content: [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }] };
  } catch (err) {
    if (err instanceof ShimError) return errorResult(err.message);
    return errorResult(err instanceof Error ? err.message : String(err));
  }
});

server.connect(new StdioServerTransport()).catch((err) => {
  process.stderr.write(`dash-mcp: failed to start: ${String(err)}\n`);
  process.exit(1);
});
