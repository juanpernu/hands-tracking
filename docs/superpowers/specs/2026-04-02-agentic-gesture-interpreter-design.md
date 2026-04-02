# Agentic Gesture Interpreter — Design Spec

**Date:** 2026-04-02
**Status:** Approved
**Author:** Juan Manuel Pernumian + Claude

---

## 1. Objective

Add an agentic layer to Hands Tracker that interprets gestures in real-time and executes actions on the browser (native APIs + DOM/tabs) and external services (via extensible plugin architecture).

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Inference model | Hybrid: client-side for known gestures, server-side for complex sequences | Balances latency (<100ms for known gestures) with future intelligence |
| Action targets | Browser APIs (Notifications, Speech, Clipboard, Fullscreen) + DOM/tabs | Covers immediate use cases without requiring a browser extension |
| External integrations | Plugin system, no specific services yet | Extensible without coupling to third-party APIs now |
| Latency requirement | Feedback < 100ms | Actions resolve locally first; server-side runs in background |
| LLM selection | Deferred | AgentBridge uses a mock for demo; model chosen at server-side implementation |
| Production target | Demo on localhost | Proof of concept to validate the approach |

## 3. Architecture

### 3.1 Layer Model

Two new layers are added between the existing Interaction Layer and Presentation Layer:

```
┌──────────────────────────────────────────────────────────────┐
│  Presentation Layer  (unchanged)                             │
│  App, DraggableObject, HandCursor, TelemetryOverlay...       │
├──────────────────────────────────────────────────────────────┤
│  Execution Layer  (NEW)                                      │
│  PluginRegistry — plugin registration with standard interface│
│  ActionDispatcher — routes actions to the correct plugin     │
│  Built-in plugins: Fullscreen, Navigation, Tabs, Clipboard,  │
│  Speech, Notifications                                       │
├──────────────────────────────────────────────────────────────┤
│  Agent Layer  (NEW)                                          │
│  GestureInterpreter — client-side rules for known gestures   │
│  ContextBuffer — sliding window of recent gestures           │
│  AgentBridge — escalation to server-side LLM (mock for demo) │
├──────────────────────────────────────────────────────────────┤
│  Interaction Layer  (extended)                               │
│  useInteractionController — emits GestureEvents to Agent Layer│
│  useGestureDetection, useMouseFallback                       │
├──────────────────────────────────────────────────────────────┤
│  Analysis Layer  (unchanged)                                 │
│  useHandAnalysis → useHandPhysics, useGripDetection,         │
│  useMotionRecognition                                        │
├──────────────────────────────────────────────────────────────┤
│  Sensing Layer  (unchanged)                                  │
│  useHandTracking — MediaPipe, camera, RAF loop               │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
useInteractionController (gesture state transitions)
       │
       ▼
  GestureEvent {type, hands, physics, grip, motion, timestamp}
       │
       ▼
  GestureInterpreter
       ├── Match local rule? → ActionIntent {plugin, action, params}
       │                              │
       │                              ▼
       │                        ActionDispatcher → Plugin.execute()
       │
       └── No match / complex sequence?
                    │
                    ▼
              ContextBuffer.getWindow()
                    │
                    ▼
              AgentBridge.interpret({gestures, context})
                    │
                    ▼
              Server LLM → ActionIntent
                    │
                    ▼
              ActionDispatcher → Plugin.execute()
```

### 3.3 Integration Principle

The existing Sensing, Analysis, and Interaction layers are not modified internally. A single `onGestureEvent` callback is added to `useInteractionController` as an optional parameter. If not provided, behavior is unchanged (backwards compatible).

## 4. Plugin System

### 4.1 Plugin Interface

```typescript
interface Plugin {
  id: string;                          // "browser.notifications"
  name: string;                        // "Notifications"
  description: string;                 // For LLM context when choosing plugins
  actions: ActionDefinition[];         // Actions this plugin exposes
  init?(): Promise<void>;             // Async setup (request permissions, etc.)
  destroy?(): void;                    // Cleanup
}

interface ActionDefinition {
  id: string;                          // "show-notification"
  description: string;                 // "Show a browser notification"
  params?: ParamSchema[];              // Parameters the action accepts
  execute(params: Record<string, unknown>): Promise<ActionResult>;
}

interface ActionResult {
  success: boolean;
  data?: unknown;                      // Output for chaining
  feedback?: string;                   // Message for the user
}

interface ParamSchema {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
}
```

### 4.2 PluginRegistry

Central registry. Simple Map internally.

```typescript
interface PluginRegistry {
  register(plugin: Plugin): void;
  unregister(pluginId: string): void;
  getPlugin(pluginId: string): Plugin | undefined;
  getAction(pluginId: string, actionId: string): ActionDefinition | undefined;
  listAll(): Plugin[];                 // For passing to LLM as context
}
```

### 4.3 ActionDispatcher

Routes ActionIntents to the correct plugin and executes them.

```typescript
interface ActionIntent {
  plugin: string;                      // "browser.fullscreen"
  action: string;                      // "toggle"
  params?: Record<string, unknown>;    // Action-specific parameters
}

interface ActionDispatcher {
  dispatch(intent: ActionIntent): Promise<ActionResult>;
}
```

Error handling: if the plugin or action is not found, returns `{success: false, feedback: "Unknown action"}`. If `execute` throws, catches and returns `{success: false, feedback: error.message}`.

### 4.4 Built-in Plugins

| Plugin ID | Actions | Default Gesture |
|---|---|---|
| `browser.fullscreen` | `toggle` | Clap |
| `browser.clipboard` | `copy-selection`, `paste` | Reserved |
| `browser.speech` | `speak-text` | Via LLM |
| `browser.notifications` | `show-notification` | Shake (feedback) |
| `dom.navigation` | `go-back`, `go-forward`, `open-url` | Swipe left/right |
| `dom.tabs` | `open-tab`, `close-tab`, `switch-tab` | Both-pinch / Both-spread |

## 5. Agent Layer

### 5.1 GestureInterpreter

Receives GestureEvents and resolves them against local rules.

```typescript
interface GestureMapping {
  gesture: GestureType;
  action: string;                      // "plugin.id:action.id" format
  params?: Record<string, unknown>;
}

type InterpretResult =
  | { resolved: true;  intent: ActionIntent }
  | { resolved: false; reason: 'no-match' | 'ambiguous' | 'complex-sequence' }
```

Resolution order:
1. **Exact match** — gesture type found in mappings → ActionIntent (<1ms)
2. **Sequence match** — consult ContextBuffer for multi-gesture patterns (<5ms)
3. **No match** — return `resolved: false`, caller decides whether to escalate

Default mappings:

```typescript
const defaultMappings: GestureMapping[] = [
  { gesture: 'clap',           action: 'browser.fullscreen:toggle' },
  { gesture: 'shake',          action: 'dom.navigation:go-back' },
  { gesture: 'swipe-left',     action: 'dom.navigation:go-back' },
  { gesture: 'swipe-right',    action: 'dom.navigation:go-forward' },
  { gesture: 'both-spread',    action: 'dom.tabs:close-tab' },
  { gesture: 'both-pinch',     action: 'dom.tabs:open-tab' },
];
```

### 5.2 ContextBuffer

Sliding window of recent gesture events. Ring buffer implementation (same pattern as existing telemetry buffers).

```typescript
interface ContextBuffer {
  push(event: GestureEvent): void;
  getWindow(lastMs: number): GestureEvent[];   // Events within last N ms
  getSequence(count: number): GestureEvent[];  // Last N events
  clear(): void;
}
```

Configuration:
- **Max events:** 50
- **Max time window:** 10 seconds
- **Structure:** Ring buffer (overwrites oldest)

### 5.3 AgentBridge

Abstract interface for server-side communication.

```typescript
interface AgentBridge {
  interpret(request: InterpretRequest): Promise<ActionIntent | null>;
  isAvailable(): boolean;
}

interface InterpretRequest {
  currentGesture: GestureEvent;
  recentGestures: GestureEvent[];      // From ContextBuffer
  availableActions: ActionDefinition[]; // From PluginRegistry
}
```

Implementations:

| Implementation | Behavior |
|---|---|
| `MockAgentBridge` | Returns `null` always, `isAvailable()` returns `false`. Used for demo. |
| `LLMAgentBridge` | POST to `/api/agent/interpret`. Server calls LLM with gestures + available actions. Model selection deferred. |

### 5.4 GestureEvent Type

```typescript
interface GestureEvent {
  type: GestureType;                    // 'pinch-start' | 'pinch-release' | 'clap' | 'shake' | ...
  hands: HandData[];                    // Raw landmarks
  physics?: HandPhysics[];             // Velocity, acceleration
  grip?: GripState[];                  // Curl, grip type
  motion?: MotionPattern;             // Swipe, circular, etc.
  timestamp: number;
}

type GestureType =
  | 'pinch-start'
  | 'pinch-release'
  | 'both-pinch'
  | 'both-spread'
  | 'clap'
  | 'shake'
  | 'swipe-left'
  | 'swipe-right'
  | 'swipe-up'
  | 'swipe-down'
  | 'circular'
  | 'grip-change';
```

## 6. Integration with Existing Code

### 6.1 Modified File

**Only `src/hooks/useInteractionController.ts` is modified.**

An optional `onGestureEvent` callback is added as a parameter. It is invoked at existing detection points:

| Detection Point | GestureEvent type |
|---|---|
| Pinch start (right hand) | `pinch-start` |
| Pinch release (right hand) | `pinch-release` |
| Both-pinch rising edge | `both-pinch` |
| Both-spread rising edge | `both-spread` |
| Shake triggered | `shake` |
| Clap detected (via onClapRef) | `clap` |

If `onGestureEvent` is not provided, no events are emitted. Zero behavioral change.

### 6.2 New Hooks

| Hook | File | Layer |
|---|---|---|
| `useGestureInterpreter` | `src/agent/hooks/useGestureInterpreter.ts` | Agent |
| `useContextBuffer` | `src/agent/hooks/useContextBuffer.ts` | Agent |
| `useAgentBridge` | `src/agent/hooks/useAgentBridge.ts` | Agent |
| `usePluginRegistry` | `src/plugins/hooks/usePluginRegistry.ts` | Execution |
| `useActionDispatcher` | `src/plugins/hooks/useActionDispatcher.ts` | Execution |

### 6.3 New Directory Structure

```
src/
  agent/
    hooks/
      useGestureInterpreter.ts
      useContextBuffer.ts
      useAgentBridge.ts
      __tests__/
        useGestureInterpreter.test.ts
        useContextBuffer.test.ts
    types.ts
  plugins/
    hooks/
      usePluginRegistry.ts
      useActionDispatcher.ts
      __tests__/
        usePluginRegistry.test.ts
        useActionDispatcher.test.ts
    built-in/
      fullscreen.ts
      navigation.ts
      tabs.ts
      clipboard.ts
      speech.ts
      notifications.ts
      __tests__/
        fullscreen.test.ts
        navigation.test.ts
    types.ts
    index.ts
  components/
    ActionToast.tsx                    # NEW: ephemeral toast for action feedback
```

### 6.4 Wiring in App.tsx

```typescript
const registry = usePluginRegistry([
  fullscreenPlugin, navigationPlugin, tabsPlugin,
  clipboardPlugin, speechPlugin, notificationsPlugin,
]);
const dispatcher = useActionDispatcher(registry);
const bridge = useAgentBridge({ enabled: false });
const buffer = useContextBuffer({ maxEvents: 50, maxMs: 10000 });
const interpreter = useGestureInterpreter({
  mappings: defaultMappings,
  buffer,
  bridge,
  onAction: dispatcher.dispatch,
});

const interaction = useInteractionController({
  // ...existing params
  onGestureEvent: interpreter.handle,
});
```

## 7. Testing

### 7.1 Test Coverage

| Target | Approach | Priority |
|---|---|---|
| GestureInterpreter mappings | Unit: GestureEvent in → ActionIntent or no-match out | High |
| ContextBuffer | Unit: push, getWindow, overflow, clear (ring buffer) | High |
| ActionDispatcher routing | Unit: mock plugins, verify routing and error handling | High |
| PluginRegistry | Unit: register, lookup, duplicate handling, listAll | Medium |
| Built-in plugins (fullscreen, navigation) | Unit: mock DOM APIs (document.requestFullscreen, window.history) | Medium |
| AgentBridge mock | Unit: returns null, isAvailable is false | Low |
| Built-in plugins (speech, notifications) | Require real browser APIs — not unit tested | Skip |

### 7.2 Test Location

Tests follow the existing `__tests__/` directory convention alongside source files.

## 8. Demo Scenario

### 8.1 Gesture-to-Action Demo

| Step | Gesture | Expected Action | Plugin |
|---|---|---|---|
| 1 | Clap | Toggle fullscreen | `browser.fullscreen` |
| 2 | Swipe left | `history.back()` | `dom.navigation` |
| 3 | Swipe right | `history.forward()` | `dom.navigation` |
| 4 | Both-pinch | Open new tab | `dom.tabs` |
| 5 | Both-spread | Close current tab | `dom.tabs` |
| 6 | Shake | Show notification "Objects cleared" | `browser.notifications` |

### 8.2 Visual Feedback

An `ActionToast` component renders an ephemeral toast (2 seconds) in the bottom-right corner showing:
- Icon of the detected gesture
- Name of the executed action
- Status (success/error)

No dependency on the Agent Layer — receives props from `ActionDispatcher` results.

### 8.3 Excluded from Demo

- Gesture mapping configuration UI
- Real server-side LLM (mock only)
- Custom user plugins (interface exists, only built-in provided)
- Configuration persistence (all in-memory)

## 9. Unchanged Code

The following are explicitly NOT modified:

- `useHandTracking` — MediaPipe integration
- `useGestureDetection` — pinch/spread detection
- `useHandAnalysis`, `useHandPhysics`, `useGripDetection`, `useMotionRecognition`
- All telemetry hooks (`useTelemetryRecorder`, `useTelemetryLogger`, `useBatchTelemetry`)
- `useObjectManagement`, `useObjectTracker`
- `useMouseFallback`, `useWindowSize`, `usePanelCollisions`
- All existing components
- All utilities (`geometry.ts`, `collision.ts`, `grip.ts`, `motion.ts`, `colors.ts`)
