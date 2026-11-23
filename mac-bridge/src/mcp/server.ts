import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(BRIDGE_ROOT, 'data', 'config.json');
const BRIDGE_URL = process.env.DEVDECK_BRIDGE_URL || `http://127.0.0.1:${process.env.BRIDGE_PORT || 4747}`;

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

const NOTIFY_TOOL_SCHEMA = {
  name: 'notify_iphone',
  description:
    'Send a live notification, task-complete alert, or approval prompt directly to the paired iPhone 14 DevDeck screen over local Wi-Fi.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short headline shown on the iPhone notification banner (e.g. "Build Passed" or "Approval Needed").',
      },
      message: {
        type: 'string',
        description: 'Concise details for the developer on the iPhone screen.',
      },
      status: {
        type: 'string',
        enum: ['info', 'success', 'warning', 'error', 'approval'],
        description:
          'Visual status & sound cue: "success" (emerald chime), "error" (crimson thud), "warning" (amber), "approval" (cyan alert with Accept/Reject buttons), or "info".',
      },
    },
    required: ['title', 'message', 'status'],
  },
};

async function callNotifyIphone(args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  const message = typeof args.message === 'string' ? args.message.trim() : '';
  const status = typeof args.status === 'string' ? args.status.trim() : 'info';

  if (!title || !message) {
    return { ok: false, text: 'Both title and message are required.' };
  }

  const token = readLocalToken();
  if (!token) {
    return {
      ok: false,
      text: `Could not read DevDeck token from ${CONFIG_PATH}. Start mac-bridge (npm run dev) first.`,
    };
  }

  try {
    const res = await fetch(`${BRIDGE_URL}/api/notify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title, message, status }),
    });
    const data = (await res.json()) as { ok?: boolean; deliveredTo?: number; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, text: data.error || `Bridge returned HTTP ${res.status}` };
    }
    return {
      ok: true,
      text: `Sent "${title}" (${status}) to ${data.deliveredTo ?? 0} connected iPhone client(s).`,
    };
  } catch (err) {
    return {
      ok: false,
      text: `Failed to reach DevDeck Mac Bridge at ${BRIDGE_URL}: ${err instanceof Error ? err.message : 'network error'}`,
    };
  }
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  // Notifications have no id and expect no response
  if (req.id === undefined || req.id === null) {
    return;
  }

  switch (req.method) {
    case 'initialize': {
      writeJsonRpc({
        id: req.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'devdeck-mcp', version: '1.0.0' },
        },
      });
      return;
    }

    case 'ping': {
      writeJsonRpc({ id: req.id, result: {} });
      return;
    }

    case 'tools/list': {
      writeJsonRpc({
        id: req.id,
        result: { tools: [NOTIFY_TOOL_SCHEMA] },
      });
      return;
    }

    case 'tools/call': {
      const name = typeof req.params?.name === 'string' ? req.params.name : '';
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;

      if (name !== 'notify_iphone') {
        writeJsonRpc({
          id: req.id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        });
        return;
      }

      const outcome = await callNotifyIphone(args);
      writeJsonRpc({
        id: req.id,
        result: {
          content: [{ type: 'text', text: outcome.text }],
          isError: !outcome.ok,
        },
      });
      return;
    }

    default: {
      writeJsonRpc({
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      });
    }
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
