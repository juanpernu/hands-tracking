import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeBatch, writeSessionSummary } from './telemetry-writer';
import type { BatchPayload, SessionSummary, WriterConfig } from './telemetry-writer';

let tempDir: string;
let config: WriterConfig;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'telemetry-test-'));
  config = { baseDir: tempDir };
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const makeBatch = (overrides: Partial<BatchPayload> = {}): BatchPayload => ({
  sessionId: 'test-session-abc',
  sequenceNum: 1,
  startTime: new Date('2026-04-02T14:30:00Z').getTime(),
  endTime: new Date('2026-04-02T14:30:10Z').getTime(),
  frames: [],
  events: [],
  ...overrides,
});

describe('writeBatch', () => {
  it('creates date/session directory and batch file', async () => {
    await writeBatch(config, makeBatch());
    const dateDir = await readdir(tempDir);
    expect(dateDir).toContain('2026-04-02');
    const sessionDir = await readdir(join(tempDir, '2026-04-02'));
    expect(sessionDir).toContain('test-session-abc');
    const files = await readdir(join(tempDir, '2026-04-02', 'test-session-abc'));
    expect(files).toContain('batch-000001.json');
  });

  it('writes valid JSON with correct payload', async () => {
    const batch = makeBatch({ sequenceNum: 5 });
    await writeBatch(config, batch);
    const content = await readFile(
      join(tempDir, '2026-04-02', 'test-session-abc', 'batch-000005.json'),
      'utf-8',
    );
    const parsed = JSON.parse(content);
    expect(parsed.sessionId).toBe('test-session-abc');
    expect(parsed.sequenceNum).toBe(5);
  });

  it('rejects sessionId with path traversal', async () => {
    await expect(writeBatch(config, makeBatch({ sessionId: '../evil' }))).rejects.toThrow(
      'Invalid sessionId',
    );
    await expect(writeBatch(config, makeBatch({ sessionId: 'foo/bar' }))).rejects.toThrow(
      'Invalid sessionId',
    );
    await expect(writeBatch(config, makeBatch({ sessionId: 'foo\\bar' }))).rejects.toThrow(
      'Invalid sessionId',
    );
  });

  it('rejects sessionId with special characters', async () => {
    await expect(writeBatch(config, makeBatch({ sessionId: 'has space' }))).rejects.toThrow('Invalid sessionId');
    await expect(writeBatch(config, makeBatch({ sessionId: '' }))).rejects.toThrow('Invalid sessionId');
    await expect(writeBatch(config, makeBatch({ sessionId: '.' }))).rejects.toThrow('Invalid sessionId');
  });

  it('rejects invalid sequenceNum', async () => {
    await expect(writeBatch(config, makeBatch({ sequenceNum: -1 }))).rejects.toThrow('Invalid sequenceNum');
    await expect(writeBatch(config, makeBatch({ sequenceNum: 1.5 }))).rejects.toThrow('Invalid sequenceNum');
    await expect(writeBatch(config, makeBatch({ sequenceNum: NaN }))).rejects.toThrow('Invalid sequenceNum');
  });

  it('rejects startTime before year 2000', async () => {
    await expect(writeBatch(config, makeBatch({ startTime: 0 }))).rejects.toThrow('Invalid startTime');
    await expect(writeBatch(config, makeBatch({ startTime: -1 }))).rejects.toThrow('Invalid startTime');
    await expect(writeBatch(config, makeBatch({ startTime: NaN }))).rejects.toThrow('Invalid startTime');
  });

  it('writes compact JSON for batches', async () => {
    await writeBatch(config, makeBatch());
    const content = await readFile(
      join(tempDir, '2026-04-02', 'test-session-abc', 'batch-000001.json'),
      'utf-8',
    );
    expect(content.includes('\n')).toBe(false);
  });

  it('does not overwrite existing batch (returns exists)', async () => {
    await writeBatch(config, makeBatch({ sequenceNum: 1 }));
    // Writing the same sequenceNum again should not throw — silently skips
    await writeBatch(config, makeBatch({ sequenceNum: 1 }));
    // File still contains the original data
    const content = await readFile(
      join(tempDir, '2026-04-02', 'test-session-abc', 'batch-000001.json'),
      'utf-8',
    );
    expect(JSON.parse(content).sequenceNum).toBe(1);
  });

  it('pads sequenceNum to 6 digits for consistent sorting', async () => {
    await writeBatch(config, makeBatch({ sequenceNum: 1 }));
    await writeBatch(config, makeBatch({ sequenceNum: 1000 }));
    const files = await readdir(join(tempDir, '2026-04-02', 'test-session-abc'));
    expect(files).toContain('batch-000001.json');
    expect(files).toContain('batch-001000.json');
    // Lexicographic sort matches numeric sort
    const sorted = [...files].sort();
    expect(sorted.indexOf('batch-000001.json')).toBeLessThan(sorted.indexOf('batch-001000.json'));
  });
});

describe('writeSessionSummary', () => {
  it('writes session-summary.json in session directory', async () => {
    const summary: SessionSummary = {
      sessionId: 'test-session-abc',
      startTime: new Date('2026-04-02T14:30:00Z').getTime(),
      endTime: new Date('2026-04-02T14:30:30Z').getTime(),
      totalFrames: 900,
      totalEvents: 15,
      totalBatches: 2,
      avgSampleRateFps: 30,
      eventBreakdown: { swipe: 5, fist: 10 },
    };
    await writeSessionSummary(config, summary);
    const content = await readFile(
      join(tempDir, '2026-04-02', 'test-session-abc', 'session-summary.json'),
      'utf-8',
    );
    const parsed = JSON.parse(content);
    expect(parsed.totalFrames).toBe(900);
    expect(parsed.eventBreakdown.swipe).toBe(5);
  });

  it('rejects invalid startTime', async () => {
    const summary: SessionSummary = {
      sessionId: 'test-session-abc',
      startTime: 0,
      endTime: 0,
      totalFrames: 0,
      totalEvents: 0,
      totalBatches: 0,
      avgSampleRateFps: 0,
      eventBreakdown: {},
    };
    await expect(writeSessionSummary(config, summary)).rejects.toThrow('Invalid startTime');
  });
});
