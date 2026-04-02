import type { Plugin } from 'vite';
import { writeBatch, writeSessionSummary } from './server/telemetry-writer';
import type { WriterConfig, BatchPayload, SessionSummary } from './server/telemetry-writer';

interface TelemetryPluginOptions {
  baseDir?: string;
}

function parseBody(req: import('node:http').IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function assertBatchPayload(data: unknown): asserts data is BatchPayload {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid payload');
  const d = data as Record<string, unknown>;
  if (typeof d.sessionId !== 'string') throw new Error('Missing sessionId');
  if (typeof d.sequenceNum !== 'number') throw new Error('Missing sequenceNum');
  if (typeof d.startTime !== 'number') throw new Error('Missing startTime');
  if (typeof d.endTime !== 'number') throw new Error('Missing endTime');
  if (!Array.isArray(d.frames)) throw new Error('Missing frames');
  if (!Array.isArray(d.events)) throw new Error('Missing events');
}

function assertSessionSummary(data: unknown): asserts data is SessionSummary {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid summary');
  const d = data as Record<string, unknown>;
  if (typeof d.sessionId !== 'string') throw new Error('Missing sessionId');
  if (typeof d.startTime !== 'number') throw new Error('Missing startTime');
  if (typeof d.endTime !== 'number') throw new Error('Missing endTime');
  if (typeof d.totalFrames !== 'number') throw new Error('Missing totalFrames');
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
            const data: unknown = JSON.parse(body);
            assertBatchPayload(data);
            await writeBatch(config, data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (req.url === '/api/telemetry/session-end') {
            const body = await parseBody(req);
            const data: unknown = JSON.parse(body);
            assertSessionSummary(data);
            await writeSessionSummary(config, data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message === 'Payload too large') {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Payload too large' }));
            return;
          }
          console.error('[telemetry-plugin]', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
          return;
        }

        next();
      });
    },
  };
}
