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

const VALID_SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

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

function dateFromTimestamp(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const createdDirs = new Set<string>();

async function ensureSessionDir(config: WriterConfig, sessionId: string, timestamp: number): Promise<string> {
  const dateStr = dateFromTimestamp(timestamp);
  const dir = join(config.baseDir, dateStr, sessionId);
  if (!createdDirs.has(dir)) {
    await mkdir(dir, { recursive: true });
    createdDirs.add(dir);
  }
  return dir;
}

export async function writeBatch(config: WriterConfig, payload: BatchPayload): Promise<void> {
  validateSessionId(payload.sessionId);
  validateSequenceNum(payload.sequenceNum);
  if (payload.frames.length > 10_000) throw new Error('Too many frames');
  if (payload.events.length > 10_000) throw new Error('Too many events');
  const dir = await ensureSessionDir(config, payload.sessionId, payload.startTime);
  const seq = String(payload.sequenceNum).padStart(3, '0');
  const filePath = join(dir, `batch-${seq}.json`);
  await writeFile(filePath, JSON.stringify(payload), 'utf-8');
}

export async function writeSessionSummary(config: WriterConfig, summary: SessionSummary): Promise<void> {
  if (typeof summary.sessionId !== 'string') throw new Error('Invalid summary: missing sessionId');
  if (typeof summary.startTime !== 'number' || !Number.isFinite(summary.startTime)) throw new Error('Invalid summary: bad startTime');
  validateSessionId(summary.sessionId);
  const dir = await ensureSessionDir(config, summary.sessionId, summary.startTime);
  const filePath = join(dir, 'session-summary.json');
  await writeFile(filePath, JSON.stringify(summary, null, 2), 'utf-8');
}
