import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(BRIDGE_ROOT, 'data', 'config.json');
const BRIDGE_URL =
  process.env.DEVDECK_BRIDGE_URL || `http://127.0.0.1:${process.env.BRIDGE_PORT || 4747}`;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function readLocalToken(): string {
  if (process.env.DEVDECK_TOKEN) return process.env.DEVDECK_TOKEN;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { token?: string };
    return parsed.token || '';
  } catch {
    return '';
  }
}

function writeJsonRpc(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...payload })}\n`);
}

const TOOLS = [
  {
    name: 'notify_iphone',
    description:
      'Send an instant live notification, task-complete alert, or approval card directly to the paired iPhone 14 DevDeck screen.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short headline shown on the iPhone notification.' },
        message: { type: 'string', description: 'Concise details for the developer.' },
        status: {
          type: 'string',
          enum: ['info', 'success', 'warning', 'error', 'approval'],
          description: 'Visual status & chime cue.',
        },
      },
      required: ['title', 'message', 'status'],
    },
  },
  {
    name: 'ask_iphone',
    description:
      'Display an interactive question with 2-4 tactile buttons on the iPhone 14 screen and wait until the developer taps an option, returning their exact choice.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Clear question to show on the iPhone screen.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: '2 to 4 short button labels (e.g. ["Approve & Push", "Run Tests First", "Cancel"]).',
        },
        timeoutSec: {
          type: 'number',
          description: 'Seconds to wait for the tap (default 120, max 300).',
        },
      },
      required: ['question', 'options'],
    },
  },
  {
    name: 'update_iphone_progress',
    description:
      'Stream a live task progress bar and current step onto the iPhone 14 OLED HUD across all screens.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title (e.g. "Refactoring Auth").' },
        step: { type: 'string', description: 'Current step description.' },
        percent: { type: 'number', minimum: 0, maximum: 100, description: 'Completion percentage (0-100).' },
        active: { type: 'boolean', description: 'Set false when done to dismiss the live bar (default true).' },
      },
      required: ['title', 'step', 'percent'],
    },
  },
  {
    name: 'get_latest_iphone_scan',
    description:
      'Retrieve the file path and timestamp of the most recent whiteboard/notebook photo snapped from the iPhone Desk Scanner.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_latest_voice_prompt',
    description:
      'Retrieve the most recent voice transcript dictated from the iPhone 14 Voice-to-Mac tool.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function bridgeFetch(
  endpoint: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const token = readLocalToken();
  if (!token) {
    return { ok: false, error: `Missing DevDeck token in ${CONFIG_PATH}. Start npm run live first.` };
  }
  try {
    const res = await fetch(`${BRIDGE_URL}${endpoint}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.ok === false) {
      return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
    }
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: `Cannot reach DevDeck bridge at ${BRIDGE_URL}: ${err instanceof Error ? err.message : 'network error'}`,
    };
  }
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
  if (name === 'notify_iphone') {
    const res = await bridgeFetch('/api/notify', {
      method: 'POST',
      body: JSON.stringify({
        title: args.title,
        message: args.message,
        status: args.status || 'info',
      }),
    });
    if (!res.ok) return { ok: false, text: res.error || 'notify failed' };
    return {
      ok: true,
      text: `Sent "${String(args.title)}" (${String(args.status || 'info')}) to ${String(res.data?.deliveredTo ?? 0)} iPhone client(s).`,
    };
  }

  if (name === 'ask_iphone') {
    const res = await bridgeFetch('/api/ask', {
      method: 'POST',
      body: JSON.stringify({
        question: args.question,
        options: args.options,
        timeoutSec: args.timeoutSec,
      }),
    });
    if (!res.ok) return { ok: false, text: res.error || 'ask_iphone timed out or failed' };
    return { ok: true, text: `User selected on iPhone: "${String(res.data?.answer ?? '')}"` };
  }

  if (name === 'update_iphone_progress') {
    const res = await bridgeFetch('/api/progress', {
      method: 'POST',
      body: JSON.stringify({
        title: args.title,
        step: args.step,
        percent: args.percent,
        active: args.active !== false,
      }),
    });
    if (!res.ok) return { ok: false, text: res.error || 'progress update failed' };
    return {
      ok: true,
      text: `Updated iPhone HUD: ${String(args.title)} — ${String(args.step)} (${String(args.percent)}%).`,
    };
  }

  if (name === 'get_latest_iphone_scan') {
    const res = await bridgeFetch('/api/latest-input');
    if (!res.ok) return { ok: false, text: res.error || 'fetch failed' };
    const scan = res.data?.latestScan as { filePath?: string; filename?: string; ts?: number } | null;
    if (!scan?.filePath) return { ok: true, text: 'No desk scan has been captured yet.' };
    return {
      ok: true,
      text: `Latest iPhone desk scan: ${scan.filePath} (captured at ${new Date(scan.ts || Date.now()).toISOString()})`,
    };
  }

  if (name === 'get_latest_voice_prompt') {
    const res = await bridgeFetch('/api/latest-input');
    if (!res.ok) return { ok: false, text: res.error || 'fetch failed' };
    const voice = res.data?.latestVoice as { text?: string; ts?: number } | null;
    if (!voice?.text) return { ok: true, text: 'No voice prompt has been dictated yet.' };
    return { ok: true, text: `Latest iPhone voice prompt: "${voice.text}"` };
  }

  return { ok: false, text: `Unknown tool: ${name}` };
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  if (req.id === undefined || req.id === null) return;

  switch (req.method) {
    case 'initialize':
      writeJsonRpc({
        id: req.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'devdeck-mcp', version: '1.1.0' },
        },
      });
      return;

    case 'ping':
      writeJsonRpc({ id: req.id, result: {} });
      return;

    case 'tools/list':
      writeJsonRpc({ id: req.id, result: { tools: TOOLS } });
      return;

    case 'tools/call': {
      const name = typeof req.params?.name === 'string' ? req.params.name : '';
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      const outcome = await handleToolCall(name, args);
      writeJsonRpc({
        id: req.id,
        result: {
          content: [{ type: 'text', text: outcome.text }],
          isError: !outcome.ok,
        },
      });
      return;
    }

    default:
      writeJsonRpc({
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed) as JsonRpcRequest;
    void handleRequest(req);
  } catch {
    // Ignore malformed stdin line
  }
});
