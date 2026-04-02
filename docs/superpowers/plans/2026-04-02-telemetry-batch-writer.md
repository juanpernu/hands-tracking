# Telemetry Batch Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continuously persist hand tracking telemetry to disk in configurable batches via a local server endpoint.

**Architecture:** Three new files — a pure Node writer module, a Vite plugin that mounts REST endpoints, and a React hook that buffers frames and flushes them. The writer is decoupled from Vite so it can be extracted to any Node server later.

**Tech Stack:** TypeScript, Node `fs/promises`, Vite `configureServer` API, React hooks, `navigator.sendBeacon`, `vitest`

---

### Task 1: Telemetry Writer Module (Node)

**Files:**
- Create: `server/telemetry-writer.ts`
- Test: `server/telemetry-writer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/telemetry-writer.test.ts`:

```typescript
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
    expect(files).toContain('batch-001.json');
  });

  it('writes valid JSON with correct payload', async () => {
    const batch = makeBatch({ sequenceNum: 5 });
    await writeBatch(config, batch);
    const content = await readFile(
      join(tempDir, '2026-04-02', 'test-session-abc', 'batch-005.json'),
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/juanpernu/Workspace/hands-tracker && npx vitest run server/telemetry-writer.test.ts`
Expected: FAIL — module `./telemetry-writer` not found.

- [ ] **Step 3: Implement the writer**

Create `server/telemetry-writer.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/juanpernu/Workspace/hands-tracker && npx vitest run server/telemetry-writer.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/telemetry-writer.ts server/telemetry-writer.test.ts
git commit -m "feat: add telemetry writer module for batch disk persistence"
```

---

### Task 2: Vite Plugin

**Files:**
- Create: `vite-plugin-telemetry.ts`
- Modify: `vite.config.ts`
- Modify: `tsconfig.node.json` (add plugin file to `include`)

- [ ] **Step 1: Create the Vite plugin**

Create `vite-plugin-telemetry.ts`:

```typescript
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
```

- [ ] **Step 2: Register the plugin in vite.config.ts**

In `vite.config.ts`, add the import and plugin registration. The file should become:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import telemetryPlugin from './vite-plugin-telemetry'

export default defineConfig({
  plugins: [react(), telemetryPlugin()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
```

- [ ] **Step 3: Add plugin to tsconfig.node.json include**

In `tsconfig.node.json`, change the `include` array to:

```json
"include": ["vite.config.ts", "vite-plugin-telemetry.ts", "server"]
```

This ensures the plugin and server module are type-checked under the Node tsconfig (they use Node APIs like `fs`, `path`).

- [ ] **Step 4: Verify the dev server starts**

Run: `cd /Users/juanpernu/Workspace/hands-tracker && npx vite --port 5174 &` then `curl -s -X POST -H "Content-Type: application/json" -d '{"sessionId":"test","sequenceNum":1,"startTime":1743609000000,"endTime":1743609010000,"frames":[],"events":[]}' http://localhost:5174/api/telemetry/batch && kill %1`
Expected: `{"ok":true}` response, and a file at `telemetry-data/2025-04-02/test/batch-001.json`.

Clean up: `rm -rf telemetry-data/`

- [ ] **Step 5: Add telemetry-data to .gitignore**

Append to `.gitignore`:

```
telemetry-data/
```

- [ ] **Step 6: Commit**

```bash
git add vite-plugin-telemetry.ts vite.config.ts tsconfig.node.json .gitignore
git commit -m "feat: add Vite plugin mounting telemetry batch endpoints"
```

---

### Task 3: React Hook (useBatchTelemetry)

**Files:**
- Create: `src/hooks/useBatchTelemetry.ts`
- Test: `src/hooks/__tests__/useBatchTelemetry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/__tests__/useBatchTelemetry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBatchTelemetry } from '../useBatchTelemetry';
import type { HandData } from '../../types';
import type { HandPhysics, GripState, MotionPattern } from '../../types/telemetry';

// Mock fetch globally
const fetchMock = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', fetchMock);

// Mock navigator.sendBeacon
const sendBeaconMock = vi.fn().mockReturnValue(true);
vi.stubGlobal('navigator', { ...navigator, sendBeacon: sendBeaconMock });

// Minimal fixture factories
function makeHand(handedness: 'Left' | 'Right' = 'Right'): HandData {
  const lm = { x: 0.5, y: 0.5, z: 0 };
  return { handedness, landmarks: Array(21).fill(lm) };
}

function makePhysics(handedness: 'Left' | 'Right' = 'Right'): HandPhysics {
  return {
    handedness,
    landmarks: [],
    wristVelocity: { x: 0, y: 0, z: 0 },
    palmVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: 0,
    dominantAxis: 'none',
    timestamp: 0,
    deltaMs: 16,
  };
}

function makeGrip(handedness: 'Left' | 'Right' = 'Right'): GripState {
  return {
    handedness,
    opennessRatio: 1,
    gripForce: 0,
    gripType: 'open',
    fingerCurl: [0, 0, 0, 0, 0],
    timestamp: 0,
  };
}

function makeMotion(): MotionPattern {
  return { type: 'none', confidence: 0, durationMs: 0, timestamp: 0 };
}

describe('useBatchTelemetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockClear();
    sendBeaconMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not flush before reaching maxFrames', () => {
    const { result } = renderHook(() =>
      useBatchTelemetry({ maxFrames: 10, maxIntervalMs: 60_000, enabled: true }),
    );

    // Record 9 frames (under threshold)
    for (let i = 0; i < 9; i++) {
      act(() => result.current.record([makeHand()], [makePhysics()], [makeGrip()], [makeMotion()], i));
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.pendingFrames).toBe(9);
  });

  it('flushes when maxFrames is reached', () => {
    const { result } = renderHook(() =>
      useBatchTelemetry({ maxFrames: 5, maxIntervalMs: 60_000, enabled: true }),
    );

    for (let i = 0; i < 5; i++) {
      act(() => result.current.record([makeHand()], [makePhysics()], [makeGrip()], [makeMotion()], i));
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('/api/telemetry/batch');
    const body = JSON.parse(call[1].body);
    expect(body.frames.length).toBe(5);
    expect(body.sequenceNum).toBe(1);
    expect(result.current.pendingFrames).toBe(0);
    expect(result.current.batchCount).toBe(1);
  });

  it('flushes on time interval', () => {
    const { result } = renderHook(() =>
      useBatchTelemetry({ maxFrames: 1000, maxIntervalMs: 5000, enabled: true }),
    );

    act(() => result.current.record([makeHand()], [makePhysics()], [makeGrip()], [makeMotion()], 100));

    // Advance past the interval
    act(() => vi.advanceTimersByTime(6000));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not record when disabled', () => {
    const { result } = renderHook(() =>
      useBatchTelemetry({ maxFrames: 2, maxIntervalMs: 60_000, enabled: false }),
    );

    for (let i = 0; i < 5; i++) {
      act(() => result.current.record([makeHand()], [makePhysics()], [makeGrip()], [makeMotion()], i));
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.pendingFrames).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/juanpernu/Workspace/hands-tracker && npx vitest run src/hooks/__tests__/useBatchTelemetry.test.ts`
Expected: FAIL — module `../useBatchTelemetry` not found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useBatchTelemetry.ts`:

```typescript
import { useRef, useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { HandData } from '../types';
import type {
  HandPhysics,
  GripState,
  MotionPattern,
  HandTelemetry,
  GestureEvent,
  Vec3,
} from '../types/telemetry';

interface BatchConfig {
  maxFrames: number;
  maxIntervalMs: number;
  enabled: boolean;
}

interface BatchTelemetryResult {
  record: (
    hands: HandData[],
    physics: HandPhysics[],
    grips: GripState[],
    motions: MotionPattern[],
    timestamp: number,
  ) => void;
  sessionId: string;
  batchCount: number;
  pendingFrames: number;
}

interface PendingBatch {
  frames: HandTelemetry[];
  events: GestureEvent[];
  startTime: number;
  endTime: number;
}

export function useBatchTelemetry(config: BatchConfig): BatchTelemetryResult {
  const { maxFrames, maxIntervalMs, enabled } = config;

  const sessionIdRef = useRef(uuidv4());
  const frameCounterRef = useRef(0);
  const sequenceRef = useRef(0);
  const [batchCount, setBatchCount] = useState(0);
  const [pendingFrames, setPendingFrames] = useState(0);

  // Mutable buffer — never triggers renders directly.
  const bufferRef = useRef<PendingBatch>({
    frames: [],
    events: [],
    startTime: 0,
    endTime: 0,
  });
  const lastFlushRef = useRef(Date.now());

  // Cumulative stats for session summary.
  const statsRef = useRef({
    totalFrames: 0,
    totalEvents: 0,
    firstTimestamp: 0,
    lastTimestamp: 0,
    eventBreakdown: {} as Record<string, number>,
  });

  // Retry queue — batches that failed to send.
  const retryQueueRef = useRef<{ payload: string; retries: number }[]>([]);
  const MAX_RETRIES = 3;

  const flush = useCallback(() => {
    const buf = bufferRef.current;
    if (buf.frames.length === 0) return;

    sequenceRef.current++;
    const seq = sequenceRef.current;

    const payload = JSON.stringify({
      sessionId: sessionIdRef.current,
      sequenceNum: seq,
      startTime: buf.startTime,
      endTime: buf.endTime,
      frames: buf.frames,
      events: buf.events,
    });

    // Reset buffer immediately so new frames don't get lost.
    bufferRef.current = { frames: [], events: [], startTime: 0, endTime: 0 };
    lastFlushRef.current = Date.now();
    setPendingFrames(0);
    setBatchCount(seq);

    fetch('/api/telemetry/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => {
      retryQueueRef.current.push({ payload, retries: 0 });
    });

    // Process retry queue.
    const queue = retryQueueRef.current;
    retryQueueRef.current = [];
    for (const item of queue) {
      if (item.retries >= MAX_RETRIES) {
        console.warn('[batch-telemetry] Dropping batch after max retries');
        continue;
      }
      fetch('/api/telemetry/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: item.payload,
      }).catch(() => {
        retryQueueRef.current.push({ payload: item.payload, retries: item.retries + 1 });
      });
    }
  }, []);

  const record = useCallback(
    (
      hands: HandData[],
      physics: HandPhysics[],
      grips: GripState[],
      motions: MotionPattern[],
      timestamp: number,
    ) => {
      if (!enabled) return;

      const buf = bufferRef.current;
      const stats = statsRef.current;

      for (let i = 0; i < hands.length; i++) {
        const hand = hands[i];
        const p = physics[i];
        const g = grips[i];
        const m = motions[i];
        if (!hand || !p || !g || !m) continue;

        const frameId = frameCounterRef.current++;
        const frame: HandTelemetry = {
          frameId,
          timestamp,
          deltaMs: p.deltaMs,
          handedness: hand.handedness,
          landmarks: hand.landmarks,
          physics: p,
          grip: g,
          motion: m,
        };

        buf.frames.push(frame);
        if (buf.startTime === 0) buf.startTime = timestamp;
        buf.endTime = timestamp;

        stats.totalFrames++;
        if (stats.firstTimestamp === 0) stats.firstTimestamp = timestamp;
        stats.lastTimestamp = timestamp;
      }

      setPendingFrames(buf.frames.length);

      if (buf.frames.length >= maxFrames) {
        flush();
      }
    },
    [enabled, maxFrames, flush],
  );

  // Interval-based flush check.
  useEffect(() => {
    if (!enabled) return;

    const id = setInterval(() => {
      const elapsed = Date.now() - lastFlushRef.current;
      if (elapsed >= maxIntervalMs && bufferRef.current.frames.length > 0) {
        flush();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [enabled, maxIntervalMs, flush]);

  // Flush on unload.
  useEffect(() => {
    const handleUnload = () => {
      const buf = bufferRef.current;
      const stats = statsRef.current;
      const sid = sessionIdRef.current;

      // Flush remaining frames.
      if (buf.frames.length > 0) {
        sequenceRef.current++;
        const batchPayload = JSON.stringify({
          sessionId: sid,
          sequenceNum: sequenceRef.current,
          startTime: buf.startTime,
          endTime: buf.endTime,
          frames: buf.frames,
          events: buf.events,
        });
        navigator.sendBeacon('/api/telemetry/batch', batchPayload);
      }

      // Send session summary.
      const durationSec = (stats.lastTimestamp - stats.firstTimestamp) / 1000;
      const summary = JSON.stringify({
        sessionId: sid,
        startTime: stats.firstTimestamp,
        endTime: stats.lastTimestamp,
        totalFrames: stats.totalFrames,
        totalEvents: stats.totalEvents,
        totalBatches: sequenceRef.current,
        avgSampleRateFps: durationSec > 0 ? stats.totalFrames / durationSec : 0,
        eventBreakdown: stats.eventBreakdown,
      });
      navigator.sendBeacon('/api/telemetry/session-end', summary);
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  return {
    record,
    sessionId: sessionIdRef.current,
    batchCount,
    pendingFrames,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/juanpernu/Workspace/hands-tracker && npx vitest run src/hooks/__tests__/useBatchTelemetry.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBatchTelemetry.ts src/hooks/__tests__/useBatchTelemetry.test.ts
git commit -m "feat: add useBatchTelemetry hook for automatic batch persistence"
```

---

### Task 4: Integration (App.tsx)

**Files:**
- Modify: `src/App.tsx:20-21` (add import)
- Modify: `src/App.tsx:43` (add hook call)
- Modify: `src/App.tsx:154` (add recordBatch call)

- [ ] **Step 1: Add import to App.tsx**

After line 21 (`import { useTelemetryLogger } from './hooks/useTelemetryLogger';`), add:

```typescript
import { useBatchTelemetry } from './hooks/useBatchTelemetry';
```

- [ ] **Step 2: Add hook call in App component**

After line 44 (`const { log, processFrame, clearLog, exportLog, onClapRef } = useTelemetryLogger();`), add:

```typescript
  const { record: recordBatch } = useBatchTelemetry({ maxFrames: 500, maxIntervalMs: 10_000, enabled: true });
```

- [ ] **Step 3: Call recordBatch in the update loop**

After line 154 (`record(hands, physics, grips, motions, now);`), add:

```typescript
    recordBatch(hands, physics, grips, motions, now);
```

- [ ] **Step 4: Verify the app compiles**

Run: `cd /Users/juanpernu/Workspace/hands-tracker && npx tsc -b --noEmit`
Expected: No type errors.

- [ ] **Step 5: Verify dev server starts and endpoints respond**

Run: `cd /Users/juanpernu/Workspace/hands-tracker && npx vite --port 5174 &` then wait 3s, then:
```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"sessionId":"smoke","sequenceNum":1,"startTime":1743609000000,"endTime":1743609010000,"frames":[],"events":[]}' \
  http://localhost:5174/api/telemetry/batch
```
Expected: `{"ok":true}`. Kill the server and clean up: `kill %1 && rm -rf telemetry-data/`

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: integrate batch telemetry persistence into main app loop"
```

---

### Task 5: Run all tests

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/juanpernu/Workspace/hands-tracker && npx vitest run`
Expected: All tests pass (writer tests + hook tests).

- [ ] **Step 2: Verify no lint errors**

Run: `cd /Users/juanpernu/Workspace/hands-tracker && npm run lint`
Expected: No errors.
