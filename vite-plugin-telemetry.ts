import type { Plugin } from 'vite';
import { writeBatch, writeSessionSummary } from './server/telemetry-writer';
import type { WriterConfig, BatchPayload, SessionSummary } from './server/telemetry-writer';

interface TelemetryPluginOptions {
  baseDir?: string;
}

function parseBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export default function telemetryPlugin(options: TelemetryPluginOptions = {}): Plugin {
  const config: WriterConfig = { baseDir: options.baseDir ?? './telemetry-data' };

  return {
    name: 'vite-plugin-telemetry',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST') return next();

        try {
          if (req.url === '/api/telemetry/batch') {
            const body = await parseBody(req);
            const payload: BatchPayload = JSON.parse(body);
            await writeBatch(config, payload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (req.url === '/api/telemetry/session-end') {
            const body = await parseBody(req);
            const summary: SessionSummary = JSON.parse(body);
            await writeSessionSummary(config, summary);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
        } catch (err) {
          console.error('[telemetry-plugin]', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
          return;
        }

        next();
      });
    },
  };
}
