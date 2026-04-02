import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface WriterConfig {
  baseDir: string;
}

export interface BatchPayload {
  sessionId: string;
  sequenceNum: number;
  startTime: number;
  endTime: number;
  frames: unknown[];
  events: unknown[];
}

export interface SessionSummary {
  sessionId: string;
  startTime: number;
  endTime: number;
  totalFrames: number;
  totalEvents: number;
  totalBatches: number;
  avgSampleRateFps: number;
  eventBreakdown: Record<string, number>;
}

const INVALID_ID = /[.]{2}|[/\\]/;

function validateSessionId(id: string): void {
  if (INVALID_ID.test(id) || id.length === 0) {
    throw new Error(`Invalid sessionId: "${id}"`);
  }
}

function dateFromTimestamp(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function ensureSessionDir(config: WriterConfig, sessionId: string, timestamp: number): Promise<string> {
  const dateStr = dateFromTimestamp(timestamp);
  const dir = join(config.baseDir, dateStr, sessionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeBatch(config: WriterConfig, payload: BatchPayload): Promise<void> {
  validateSessionId(payload.sessionId);
  const dir = await ensureSessionDir(config, payload.sessionId, payload.startTime);
  const seq = String(payload.sequenceNum).padStart(3, '0');
  const filePath = join(dir, `batch-${seq}.json`);
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

export async function writeSessionSummary(config: WriterConfig, summary: SessionSummary): Promise<void> {
  validateSessionId(summary.sessionId);
  const dir = await ensureSessionDir(config, summary.sessionId, summary.startTime);
  const filePath = join(dir, 'session-summary.json');
  await writeFile(filePath, JSON.stringify(summary, null, 2), 'utf-8');
}
