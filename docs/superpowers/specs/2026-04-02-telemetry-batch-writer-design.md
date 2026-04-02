# Telemetry Batch Writer — Design Spec

## Overview

A continuous telemetry persistence module that writes hand tracking data to disk in configurable batches. Runs alongside the existing in-memory telemetry system (which continues to power the live UI) without replacing it.

## Architecture

```
Browser (React)                         Node (Vite dev server)
┌─────────────────────┐                ┌──────────────────────────────┐
│ useBatchTelemetry   │                │ vite-plugin-telemetry        │
│                     │  POST /api/    │                              │
│  Frame buffer ──────┼──batch-write──>│  telemetry-writer.ts         │
│  (500 frames or 10s)│                │  ├─ mkdirp(date/session/)    │
│                     │  POST /api/    │  ├─ write batch-{seq}.json   │
│  beforeunload ──────┼──session-end──>│  └─ write session-summary    │
│  (sendBeacon)       │                │                              │
└─────────────────────┘                └──────────────────────────────┘
```

### Files

| File | Type | Responsibility |
|------|------|----------------|
| `server/telemetry-writer.ts` | Node module (new) | Receives batch data, writes to disk. No Vite dependency — extractable to any Node server. |
| `vite-plugin-telemetry.ts` | Vite plugin (new) | Mounts REST endpoints on the dev server, delegates to the writer. |
| `src/hooks/useBatchTelemetry.ts` | React hook (new) | Accumulates frames in memory, flushes via POST when threshold is reached. |
| `vite.config.ts` | Config (modified) | Registers the plugin. |
| `src/App.tsx` | Component (modified) | Connects `useBatchTelemetry` alongside existing telemetry hooks. |

## Data persisted per batch

Full frames (landmarks, physics, grip, motion per hand) plus discrete gesture events — the same data shape as the existing `TelemetrySession` type, split into sequential chunks.

## Flush triggers

Whichever occurs first:
- **Frame count**: 500 frames accumulated
- **Time interval**: 10 seconds since last flush

Both values are configurable via the hook.

## Disk layout

```
{baseDir}/                          # default: ./telemetry-data
└── {YYYY-MM-DD}/                   # date derived from first batch startTime
    └── {sessionId}/
        ├── batch-001.json
        ├── batch-002.json
        ├── ...
        └── session-summary.json
```

## Component details

### 1. `server/telemetry-writer.ts`

Pure Node module. No framework dependency.

```typescript
interface WriterConfig {
  baseDir: string; // default: './telemetry-data'
}

interface BatchPayload {
  sessionId: string;
  sequenceNum: number;
  startTime: number;
  endTime: number;
  frames: HandTelemetry[];
  events: GestureEvent[];
}

interface SessionSummary {
  sessionId: string;
  startTime: number;
  endTime: number;
  totalFrames: number;
  totalEvents: number;
  totalBatches: number;
  avgSampleRateFps: number;
  eventBreakdown: Record<string, number>; // event type -> count
}
```

**Functions:**
- `writeBatch(config, payload)`: creates directory `{baseDir}/{YYYY-MM-DD}/{sessionId}/` (recursive mkdir), writes `batch-{sequenceNum zero-padded to 3}.json`.
- `writeSessionSummary(config, summary)`: writes `session-summary.json` in the session directory.

**Date derivation**: the `YYYY-MM-DD` directory name comes from the batch's `startTime`, not the server clock, for consistency across time zones.

**Validation**: `sessionId` is checked against path traversal patterns (`..`, `/`, `\`). Invalid values are rejected with an error.

### 2. `vite-plugin-telemetry.ts`

Uses Vite's `configureServer` hook to add middleware.

**Config:**
```typescript
telemetryPlugin({ baseDir?: string }) // default: './telemetry-data'
```

**Endpoints:**
- `POST /api/telemetry/batch` — JSON body with `BatchPayload`. Calls `writeBatch()`. Returns 200 on success, 500 on fs error.
- `POST /api/telemetry/session-end` — accepts both `application/json` and `text/plain` content types (to support `sendBeacon` which cannot set JSON headers). Body is `SessionSummary`. Calls `writeSessionSummary()`. Returns 200.

**Integration in vite.config.ts:**
```typescript
import telemetryPlugin from './vite-plugin-telemetry';

export default defineConfig({
  plugins: [
    react(),
    telemetryPlugin({ baseDir: './telemetry-data' }),
  ],
  // existing server config unchanged
});
```

### 3. `src/hooks/useBatchTelemetry.ts`

React hook that runs in the browser.

**Config:**
```typescript
interface BatchConfig {
  maxFrames: number;     // default: 500
  maxIntervalMs: number; // default: 10_000 (10 seconds)
  enabled: boolean;      // default: true
}
```

**Behavior:**
1. Generates a `sessionId` (uuid) on mount.
2. Maintains a mutable ref array accumulating `HandTelemetry` frames and `GestureEvent` entries.
3. A `setInterval` (1s tick) checks if `maxIntervalMs` has elapsed since the last flush.
4. When `maxFrames` is reached OR `maxIntervalMs` elapses: `fetch POST /api/telemetry/batch` with the buffer contents, clear the buffer, increment `sequenceNum`.
5. On `beforeunload`: two sequential `sendBeacon` calls — first to `/api/telemetry/batch` with remaining frames (if any), then to `/api/telemetry/session-end` with the session summary. Both use `text/plain` content type (sendBeacon limitation).

**Exposed API:**
```typescript
interface BatchTelemetryResult {
  record: (
    hands: HandData[],
    physics: HandPhysics[],
    grips: GripState[],
    motions: MotionPattern[],
    timestamp: number,
  ) => void;
  sessionId: string;
  batchCount: number;    // number of batches flushed so far
  pendingFrames: number; // frames in current buffer
}
```

**`record()` signature matches the existing `useTelemetryRecorder.record()`** — same parameters, called from the same place in App.tsx.

**Integration in App.tsx:**
```typescript
const { record: recordBatch } = useBatchTelemetry({ enabled: true });

// In the existing update loop, alongside telemetryRecorder.record():
recordBatch(hands, physicsResults, gripResults, motionResults, now);
```

### 4. Session summary

Computed in the frontend on `beforeunload`. Contains:

```typescript
{
  sessionId: string;
  startTime: number;        // timestamp of first frame ever recorded
  endTime: number;          // timestamp of last frame
  totalFrames: number;
  totalEvents: number;
  totalBatches: number;
  avgSampleRateFps: number; // totalFrames / duration in seconds
  eventBreakdown: {         // gesture event type -> count
    'pinch-start': 5,
    'swipe': 12,
    // ...
  };
}
```

## Error handling

- **POST failure (server down)**: the batch is retained in memory and retried on the next flush cycle. Maximum 3 retries per batch; after that, the batch is discarded with a `console.warn`.
- **Path traversal**: the writer rejects `sessionId` values containing `..`, `/`, or `\`.
- **Disk write failure**: the endpoint responds 500 and logs the error to the server console. The frontend treats this as a POST failure (retry logic applies).

## Testing

- **`server/telemetry-writer.ts`**: unit tests using a temporary directory (`os.tmpdir()`). Verify correct directory creation, file naming, JSON content, and path traversal rejection.
- **`src/hooks/useBatchTelemetry.ts`**: unit tests with mocked `fetch`. Verify flush-by-frame-count, flush-by-time, sendBeacon on unload, and retry behavior.
- **Plugin**: not directly tested (minimal glue code).

## What this does NOT change

- `useTelemetryRecorder` and `useTelemetryLogger` continue to work as-is for the live UI (skeleton, HUD, event log, gesture timeline).
- The existing `telemetry/` directory with manual exports is unaffected. Consider adding `telemetry-data/` to `.gitignore`.
