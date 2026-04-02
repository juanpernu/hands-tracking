import { mkdir, open } from 'node:fs/promises';
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

const VALID_SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const MIN_VALID_TIMESTAMP = 946_684_800_000; // 2000-01-01T00:00:00Z

function validateSessionId(id: string): void {
  if (!VALID_SESSION_ID.test(id)) {
    throw new Error('Invalid sessionId');
  }
}

function validateSequenceNum(n: number): void {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) {
    throw new Error('Invalid sequenceNum');
  }
}

function validateTimestamp(ts: number, field: string): void {
  if (!Number.isFinite(ts) || ts < MIN_VALID_TIMESTAMP) {
    throw new Error(`Invalid ${field}`);
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

async function writeFileExclusive(filePath: string, content: string): Promise<'written' | 'exists'> {
  try {
    const fh = await open(filePath, 'wx');
    await fh.writeFile(content, 'utf-8');
    await fh.close();
    return 'written';
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
    throw err;
  }
}

export async function writeBatch(config: WriterConfig, payload: BatchPayload): Promise<void> {
  validateSessionId(payload.sessionId);
  validateSequenceNum(payload.sequenceNum);
  validateTimestamp(payload.startTime, 'startTime');
  if (payload.frames.length > 10_000) throw new Error('Too many frames');
  if (payload.events.length > 10_000) throw new Error('Too many events');
  const dir = await ensureSessionDir(config, payload.sessionId, payload.startTime);
  const seq = String(payload.sequenceNum).padStart(6, '0');
  const filePath = join(dir, `batch-${seq}.json`);
  await writeFileExclusive(filePath, JSON.stringify(payload));
}

export async function writeSessionSummary(config: WriterConfig, summary: SessionSummary): Promise<void> {
  if (typeof summary.sessionId !== 'string') throw new Error('Invalid summary: missing sessionId');
  validateSessionId(summary.sessionId);
  validateTimestamp(summary.startTime, 'startTime');
  const dir = await ensureSessionDir(config, summary.sessionId, summary.startTime);
  const filePath = join(dir, 'session-summary.json');
  // Summary uses regular writeFile — overwrites are expected (final summary replaces partial).
  const { writeFile } = await import('node:fs/promises');
  await writeFile(filePath, JSON.stringify(summary, null, 2), 'utf-8');
}
