# Ollama LLM Bridge — Design Spec

**Date:** 2026-04-05
**Status:** Approved
**Branch:** worktree-synthetic-prancing-bonbon
**Model:** gemma4:e2b (7.2GB, 2.3B params, 128K context)

## Goal

Connect the gesture interpreter to a local Ollama instance running gemma4:e2b via streaming chat. The LLM acts as a passive observer of the gesture stream, staying silent (`_`) most of the time and only intervening with a JSON action when it detects a meaningful multi-gesture pattern or spatial context combination that the exact-match system cannot handle.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Communication | Streaming (`/api/chat` stream:true) | Model stays hot in RAM, first-token latency ~10ms for silence |
| LLM role | Continuous observer | Receives all gestures, intervenes proactively on complex patterns |
| Context | Gestures + spatial data | Knows what DOM element each hand is over |
| Silence format | Single `_` token | 90%+ responses are 1 token (~10ms), JSON only when actionable |

## Architecture

```
RAF Loop (30fps)
  |
  +- Exact match (0ms) --> execute action immediately
  |
  +- Debounce (100ms) --> format gesture message
                            |
                            v
                     useOllamaStream
                            |
                            +- send() via /api/chat stream:true
                            |
                     Ollama (localhost:11434)
                     gemma4:e2b (keep_alive: 5min)
                            |
                            +- "_" (silence, ~10ms) --> ignore
                            +- '{"plugin":"...","action":"..."}' --> dispatch action
```

## Hook 1: `useOllamaStream`

**File:** `src/agent/hooks/useOllamaStream.ts`

Manages a persistent streaming chat connection with Ollama.

```typescript
interface UseOllamaStreamOptions {
  model: string;
  baseUrl: string;
  systemPrompt: string;
  keepAliveMs: number;
}

interface UseOllamaStreamReturn {
  send: (message: string) => void;
  onResponse: React.MutableRefObject<((response: OllamaResponse) => void) | null>;
  isConnected: boolean;
  reconnect: () => void;
}

type OllamaResponse =
  | { type: 'silence' }
  | { type: 'action'; intent: ActionIntent }
  | { type: 'error'; message: string }
```

**Behavior:**
- Uses `fetch` with Ollama's `/api/chat` endpoint, `stream: true`
- Each `send()` creates a new streaming request with the full message history (rolling window)
- Reads `ReadableStream` via reader — each chunk is a JSON line with `{"message":{"content":"..."},"done":false}`
- Accumulates content tokens until `"done": true`
- Parses response: first char `{` → JSON.parse → `action`, `_` → `silence`, else → `error`
- Auto-reconnect with exponential backoff (1s → 2s → 4s → ... → 30s cap)
- `keep_alive` parameter in each request keeps model loaded in GPU/RAM
- Rolling message window: keeps last 100 messages to avoid context overflow
- Debounced: drops gestures if previous response hasn't arrived yet

**Graceful degradation:**
- If Ollama is unreachable, `isConnected = false`
- No errors thrown — just returns null silently
- App continues working with exact-match mappings only

## Hook 2: `useAgentBridge` (rewrite)

**File:** `src/agent/hooks/useAgentBridge.ts`

Rewritten to use `useOllamaStream` instead of the stub fetch.

```typescript
interface AgentBridgeConfig {
  enabled: boolean;
  spatialRef?: React.MutableRefObject<{ left: HandSpatialState | null; right: HandSpatialState | null }>;
}
```

**Behavior:**
- Initializes `useOllamaStream` with system prompt from `ollama-config.ts`
- `interpret(request)` formats the gesture + spatial data into the compact message format, calls `send()`
- `onResponse` callback dispatches actions when LLM responds with JSON
- `isAvailable()` returns `stream.isConnected && config.enabled`

## Config: `src/agent/ollama-config.ts`

**Contains:**
- `SYSTEM_PROMPT` — the full system prompt with action list placeholder
- `formatGestureMessage(gesture, spatial)` — formats to compact `G:...|V:...|GR:...|SP:...` format
- `buildSystemPrompt(actions)` — injects available actions into the prompt template

**Message format:**
```
G:swipe-left|V:0.8,0.1|GR:open|SP:button.submit,4,1.2s
```
- `G:` gesture type
- `V:` velocity x,y (normalized, 1 decimal)
- `GR:` grip type
- `SP:` spatial target selector, score, hover duration (or `none`)

~15-20 tokens per message.

**System prompt:**
```
You are a real-time gesture interpreter for a hand-tracking application.

You observe a continuous stream of hand gestures and spatial context.
Most gestures are routine — respond with "_" (single underscore) for those.
Only respond with a JSON action when you detect a meaningful pattern that
the simple gesture mappings cannot handle.

Respond with "_" when:
- The gesture is a common single gesture (pinch, swipe, etc.)
- The gesture is ambiguous and needs more context
- Nothing actionable is happening

Respond with JSON when you detect:
- A multi-gesture sequence that maps to a specific action
- A gesture + spatial context combination (e.g., sustained hover + pinch = click)
- A complex pattern the exact-match system would miss

JSON format: {"plugin":"<plugin-id>","action":"<action-id>"}

Available actions:
{{ACTIONS_LIST}}

Rules:
- NEVER explain. NEVER add text. Only "_" or valid JSON.
- One response per message. No multi-line.
- You are an observer. Most of the time, stay silent with "_".
```

## Config Constants

Add to `src/config.ts`:

```typescript
export const OLLAMA = {
  MODEL: 'gemma4:e2b',
  BASE_URL: 'http://localhost:11434',
  KEEP_ALIVE_MS: 300_000,
  RECONNECT_BASE_MS: 1000,
  RECONNECT_MAX_MS: 30_000,
  MAX_CONTEXT_MESSAGES: 100,
  DEBOUNCE_MS: 100,
} as const;
```

## App.tsx Integration

1. Change `useAgentBridge({ enabled: false })` → `useAgentBridge({ enabled: true, spatialRef: handOverDOM.handSpatialRef })`
2. The gesture interpreter already has escalation logic — no changes needed there
3. Bridge auto-connects to Ollama on mount, gracefully degrades if unavailable

## File Inventory

| File | Responsibility | Est. Lines |
|------|---------------|-----------|
| `src/agent/hooks/useOllamaStream.ts` | Streaming connection, parsing, reconnect | ~120 |
| `src/agent/ollama-config.ts` | System prompt, message formatter | ~60 |
| `src/agent/hooks/useAgentBridge.ts` | Rewrite: wire to stream | ~40 |
| `src/agent/types.ts` | Add OllamaResponse type | ~10 |
| `src/config.ts` | Add OLLAMA section | ~10 |
| `src/App.tsx` | Enable bridge, pass spatial ref | ~5 |

**Total: ~245 lines, 2 new files, 4 modified files.**
