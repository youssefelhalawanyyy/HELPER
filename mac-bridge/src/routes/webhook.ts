import crypto from 'node:crypto';
import { Router } from 'express';
import type { WebhookEvent } from '../types/protocol.js';

export class WebhookStore {
  private events: WebhookEvent[] = [];
  private readonly maxEvents = 40;

  constructor(private onEvent: (ev: WebhookEvent) => void) {}

  getRecent(): WebhookEvent[] {
    return this.events;
  }

  getById(id: string): WebhookEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  record(ev: WebhookEvent): void {
    this.events = [ev, ...this.events].slice(0, this.maxEvents);
    this.onEvent(ev);
  }

  async replay(
    eventId: string,
    targetBaseUrl: string,
  ): Promise<{ ok: boolean; message: string; statusCode?: number }> {
    const ev = this.getById(eventId);
    if (!ev) return { ok: false, message: 'Webhook event not found' };

    const base = targetBaseUrl.replace(/\/$/, '');
    const targetUrl = `${base}${ev.path}`;
    const start = Date.now();
    try {
      const hasBody = !['GET', 'HEAD'].includes(ev.method.toUpperCase()) && ev.body !== undefined;
      const res = await fetch(targetUrl, {
        method: ev.method,
        headers: { 'content-type': 'application/json', 'x-devdeck-replayed': 'true' },
        body: hasBody
          ? typeof ev.body === 'string'
            ? ev.body
            : JSON.stringify(ev.body)
          : undefined,
      });
      const latencyMs = Date.now() - start;
      return {
        ok: res.ok,
        statusCode: res.status,
        message: `Replayed ${ev.method} ${ev.path} → ${res.status} (${latencyMs}ms)`,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Replay failed: ${err instanceof Error ? err.message : 'network error'}`,
      };
    }
  }
}

export function createWebhookRouter(store: WebhookStore): Router {
  const router = Router();

  router.all(/(.*)/, (req, res) => {
    const started = Date.now();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
      else if (Array.isArray(v)) headers[k] = v.join(', ');
    }
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) {
      query[k] = String(v);
    }

    const statusCode = 200;
    const latencyMs = Math.max(1, Date.now() - started);
    const event: WebhookEvent = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      method: req.method,
      path: req.originalUrl,
      query,
      headers,
      body: req.body ?? null,
      statusCode,
      latencyMs,
    };

    store.record(event);
    res.status(statusCode).json({
      ok: true,
      received: true,
      id: event.id,
      method: event.method,
      path: event.path,
    });
  });

  return router;
}
