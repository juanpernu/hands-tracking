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
    let done = false;

    const onData = (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        done = true;
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
        req.resume(); // drain remaining data so socket stays alive for the 413 response
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString('utf-8'));
    };

    const onError = (err: Error) => {
      if (done) return;
      done = true;
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function assertBatchPayload(data: unknown): asserts data is BatchPayload {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid payload');
  const d = data as Record<string, unknown>;
  if (typeof d.sessionId !== 'string') throw new Error('Missing sessionId');
  if (typeof d.sequenceNum !== 'number' || !Number.isInteger(d.sequenceNum) || (d.sequenceNum as number) < 0) {
    throw new Error('Invalid sequenceNum');
  }
  if (typeof d.startTime !== 'number' || !Number.isFinite(d.startTime as number)) throw new Error('Invalid startTime');
  if (typeof d.endTime !== 'number') throw new Error('Missing endTime');
  if (!Array.isArray(d.frames)) throw new Error('Missing frames');
  if (!Array.isArray(d.events)) throw new Error('Missing events');
}

function assertSessionSummary(data: unknown): asserts data is SessionSummary {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid summary');
  const d = data as Record<string, unknown>;
  if (typeof d.sessionId !== 'string') throw new Error('Missing sessionId');
  if (typeof d.startTime !== 'number' || !Number.isFinite(d.startTime as number)) throw new Error('Invalid startTime');
  if (typeof d.endTime !== 'number') throw new Error('Missing endTime');
  if (typeof d.totalFrames !== 'number') throw new Error('Missing totalFrames');
}

function getPathname(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url;
  }
}

const BLOCKED_HOSTS = /^(169\.254\.|metadata\.google\.internal)/i;

function isSafeProxyTarget(rawUrl: string): boolean {
  try {
    const { hostname, protocol } = new URL(rawUrl);
    if (!['http:', 'https:'].includes(protocol)) return false;
    if (BLOCKED_HOSTS.test(hostname)) return false;
    return true;
  } catch { return false; }
}

export default function telemetryPlugin(options: TelemetryPluginOptions = {}): Plugin {
  const config: WriterConfig = { baseDir: options.baseDir ?? './telemetry-data' };

  return {
    name: 'vite-plugin-telemetry',
    configureServer(server) {
      // Proxy for iframe navigation — strips X-Frame-Options and CSP headers
      server.middlewares.use('/api/proxy', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost').searchParams.get('url');
        if (!url || !isSafeProxyTarget(url)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing or invalid url parameter');
          return;
        }

        try {
          const upstream = await fetch(url, {
            headers: {
              'User-Agent': 'hands-tracker-proxy/1.0',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
            },
            redirect: 'follow',
          });

          // Copy headers, stripping iframe-blocking ones
          const blocked = new Set([
            'x-frame-options',
            'content-security-policy',
            'content-security-policy-report-only',
            'cross-origin-embedder-policy',
            'cross-origin-opener-policy',
            'cross-origin-resource-policy',
          ]);
          const headers: Record<string, string> = {};
          upstream.headers.forEach((value, key) => {
            if (!blocked.has(key.toLowerCase())) {
              headers[key] = value;
            }
          });

          // Rewrite relative URLs in HTML to absolute
          const contentType = upstream.headers.get('content-type') || 'text/html';

          if (contentType.includes('text/html')) {
            let html = await upstream.text();
            // Inject a <base> tag so relative URLs resolve against the original domain
            const origin = new URL(url).origin;
            const baseTag = `<base href="${origin}/">`;
            // Inject scroll listener that responds to postMessage from parent
            const appOrigin = `http://localhost:${server.config.server.port || 5173}`;
            const scrollScript = `<script>window.addEventListener('message',function(e){if(e.origin!=='${appOrigin}')return;if(e.data&&e.data.type==='hands-tracker-scroll'){window.scrollBy(e.data.deltaX,e.data.deltaY);}});<\/script>`;
            html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${scrollScript}`);
            headers['content-type'] = contentType;
            delete headers['content-length']; // length changed
            res.writeHead(upstream.status, headers);
            res.end(html);
          } else {
            // Non-HTML (CSS, JS, images) — pipe through
            const buffer = Buffer.from(await upstream.arrayBuffer());
            res.writeHead(upstream.status, headers);
            res.end(buffer);
          }
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end(`Proxy error: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      });

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST') return next();

        const pathname = getPathname(req.url);

        try {
          if (pathname === '/api/telemetry/batch') {
            const body = await parseBody(req);
            const data: unknown = JSON.parse(body);
            assertBatchPayload(data);
            await writeBatch(config, data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (pathname === '/api/telemetry/session-end') {
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
