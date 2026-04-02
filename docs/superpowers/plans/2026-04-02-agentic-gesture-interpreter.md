# Agentic Gesture Interpreter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Agent Layer and Execution Layer to Hands Tracker that interprets gestures and executes browser actions via a plugin system.

**Architecture:** Two new layers (Agent + Execution) sit between the existing Interaction Layer and Presentation Layer. The only modification to existing code is adding an `onGestureEvent` callback to `useInteractionController`. Everything else is new code.

**Tech Stack:** React 19, TypeScript 5.9, Vitest (testing), existing MediaPipe hand tracking pipeline.

**Execution Strategy:** 4 waves of parallel agents, each wave has a tech-lead coordinator.

---

## Wave 1: Foundation (Parallel — No Dependencies)

### Task 1: Plugin Types

**Files:**
- Create: `src/plugins/types.ts`

- [ ] **Step 1: Create plugin type definitions**

```typescript
// src/plugins/types.ts

export interface ParamSchema {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
}

export interface ActionResult {
  success: boolean;
  data?: unknown;
  feedback?: string;
}

export interface ActionDefinition {
  id: string;
  description: string;
  params?: ParamSchema[];
  execute(params: Record<string, unknown>): Promise<ActionResult>;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  actions: ActionDefinition[];
  init?(): Promise<void>;
  destroy?(): void;
}

export interface ActionIntent {
  plugin: string;
  action: string;
  params?: Record<string, unknown>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/types.ts
git commit -m "feat(plugins): add plugin system type definitions"
```

---

### Task 2: Agent Types

**Files:**
- Create: `src/agent/types.ts`

- [ ] **Step 1: Create agent type definitions**

```typescript
// src/agent/types.ts

import type { HandData } from '../types';
import type { HandPhysics, GripState, MotionPattern } from '../types/telemetry';
import type { ActionIntent, ActionDefinition } from '../plugins/types';

export type AgentGestureType =
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

export interface AgentGestureEvent {
  type: AgentGestureType;
  hands: HandData[];
  physics?: HandPhysics[];
  grip?: GripState[];
  motion?: MotionPattern;
  timestamp: number;
}

export type InterpretResult =
  | { resolved: true; intent: ActionIntent }
  | { resolved: false; reason: 'no-match' | 'ambiguous' | 'complex-sequence' };

export interface GestureMapping {
  gesture: AgentGestureType;
  action: string; // "plugin.id:action.id" format
  params?: Record<string, unknown>;
}

export interface InterpretRequest {
  currentGesture: AgentGestureEvent;
  recentGestures: AgentGestureEvent[];
  availableActions: ActionDefinition[];
}

export interface AgentBridge {
  interpret(request: InterpretRequest): Promise<ActionIntent | null>;
  isAvailable(): boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/types.ts
git commit -m "feat(agent): add agent layer type definitions"
```

---

### Task 3: ContextBuffer Hook + Test

**Files:**
- Create: `src/agent/hooks/useContextBuffer.ts`
- Test: `src/agent/hooks/__tests__/useContextBuffer.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/agent/hooks/__tests__/useContextBuffer.test.ts

import { renderHook, act } from '@testing-library/react';
import { useContextBuffer } from '../useContextBuffer';
import type { AgentGestureEvent } from '../../types';

function makeEvent(type: string, timestamp: number): AgentGestureEvent {
  return {
    type: type as AgentGestureEvent['type'],
    hands: [],
    timestamp,
  };
}

describe('useContextBuffer', () => {
  it('pushes and retrieves events', () => {
    const { result } = renderHook(() => useContextBuffer({ maxEvents: 50, maxMs: 10000 }));

    act(() => {
      result.current.push(makeEvent('clap', 1000));
      result.current.push(makeEvent('shake', 2000));
    });

    expect(result.current.getSequence(2)).toHaveLength(2);
    expect(result.current.getSequence(2)[0].type).toBe('clap');
    expect(result.current.getSequence(2)[1].type).toBe('shake');
  });

  it('respects maxEvents capacity (ring buffer)', () => {
    const { result } = renderHook(() => useContextBuffer({ maxEvents: 3, maxMs: 10000 }));

    act(() => {
      result.current.push(makeEvent('clap', 1000));
      result.current.push(makeEvent('shake', 2000));
      result.current.push(makeEvent('both-pinch', 3000));
      result.current.push(makeEvent('both-spread', 4000));
    });

    const seq = result.current.getSequence(10);
    expect(seq).toHaveLength(3);
    expect(seq[0].type).toBe('shake');
    expect(seq[2].type).toBe('both-spread');
  });

  it('getWindow filters by time', () => {
    const { result } = renderHook(() => useContextBuffer({ maxEvents: 50, maxMs: 10000 }));

    act(() => {
      result.current.push(makeEvent('clap', 1000));
      result.current.push(makeEvent('shake', 5000));
      result.current.push(makeEvent('both-pinch', 9000));
    });

    const window = result.current.getWindow(4000, 9500);
    expect(window).toHaveLength(2);
    expect(window[0].type).toBe('shake');
  });

  it('clear empties the buffer', () => {
    const { result } = renderHook(() => useContextBuffer({ maxEvents: 50, maxMs: 10000 }));

    act(() => {
      result.current.push(makeEvent('clap', 1000));
      result.current.clear();
    });

    expect(result.current.getSequence(10)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agent/hooks/__tests__/useContextBuffer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useContextBuffer**

```typescript
// src/agent/hooks/useContextBuffer.ts

import { useRef, useCallback } from 'react';
import type { AgentGestureEvent } from '../types';

interface ContextBufferConfig {
  maxEvents: number;
  maxMs: number;
}

export function useContextBuffer(config: ContextBufferConfig) {
  const bufferRef = useRef<AgentGestureEvent[]>([]);
  const headRef = useRef(0);
  const sizeRef = useRef(0);

  // Initialize buffer array once
  if (bufferRef.current.length !== config.maxEvents) {
    bufferRef.current = new Array(config.maxEvents).fill(null);
    headRef.current = 0;
    sizeRef.current = 0;
  }

  const push = useCallback((event: AgentGestureEvent) => {
    bufferRef.current[headRef.current] = event;
    headRef.current = (headRef.current + 1) % config.maxEvents;
    if (sizeRef.current < config.maxEvents) sizeRef.current++;
  }, [config.maxEvents]);

  const getSequence = useCallback((count: number): AgentGestureEvent[] => {
    const size = sizeRef.current;
    const n = Math.min(count, size);
    const result: AgentGestureEvent[] = [];
    const start = size < config.maxEvents ? 0 : headRef.current;
    // Read from oldest to newest, but only last n
    const skip = size - n;
    for (let i = skip; i < size; i++) {
      result.push(bufferRef.current[(start + i) % config.maxEvents]);
    }
    return result;
  }, [config.maxEvents]);

  const getWindow = useCallback((lastMs: number, now: number): AgentGestureEvent[] => {
    const cutoff = now - lastMs;
    const size = sizeRef.current;
    const start = size < config.maxEvents ? 0 : headRef.current;
    const result: AgentGestureEvent[] = [];
    for (let i = 0; i < size; i++) {
      const event = bufferRef.current[(start + i) % config.maxEvents];
      if (event && event.timestamp >= cutoff) result.push(event);
    }
    return result;
  }, [config.maxEvents]);

  const clear = useCallback(() => {
    headRef.current = 0;
    sizeRef.current = 0;
  }, []);

  return { push, getSequence, getWindow, clear };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agent/hooks/__tests__/useContextBuffer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/
git commit -m "feat(agent): add useContextBuffer hook with ring buffer"
```

---

### Task 4: PluginRegistry Hook + Test

**Files:**
- Create: `src/plugins/hooks/usePluginRegistry.ts`
- Test: `src/plugins/hooks/__tests__/usePluginRegistry.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/plugins/hooks/__tests__/usePluginRegistry.test.ts

import { renderHook, act } from '@testing-library/react';
import { usePluginRegistry } from '../usePluginRegistry';
import type { Plugin } from '../../types';

const mockPlugin: Plugin = {
  id: 'test.plugin',
  name: 'Test Plugin',
  description: 'A test plugin',
  actions: [
    {
      id: 'do-thing',
      description: 'Does a thing',
      execute: async () => ({ success: true }),
    },
  ],
};

const mockPlugin2: Plugin = {
  id: 'test.plugin2',
  name: 'Test Plugin 2',
  description: 'Another test plugin',
  actions: [
    {
      id: 'do-other',
      description: 'Does another thing',
      execute: async () => ({ success: true }),
    },
  ],
};

describe('usePluginRegistry', () => {
  it('registers initial plugins', () => {
    const { result } = renderHook(() => usePluginRegistry([mockPlugin]));
    expect(result.current.getPlugin('test.plugin')).toBe(mockPlugin);
  });

  it('registers plugins dynamically', () => {
    const { result } = renderHook(() => usePluginRegistry([]));

    act(() => {
      result.current.register(mockPlugin);
    });

    expect(result.current.getPlugin('test.plugin')).toBe(mockPlugin);
  });

  it('returns undefined for unknown plugin', () => {
    const { result } = renderHook(() => usePluginRegistry([]));
    expect(result.current.getPlugin('nonexistent')).toBeUndefined();
  });

  it('gets specific action from plugin', () => {
    const { result } = renderHook(() => usePluginRegistry([mockPlugin]));
    const action = result.current.getAction('test.plugin', 'do-thing');
    expect(action).toBeDefined();
    expect(action!.id).toBe('do-thing');
  });

  it('returns undefined for unknown action', () => {
    const { result } = renderHook(() => usePluginRegistry([mockPlugin]));
    expect(result.current.getAction('test.plugin', 'nonexistent')).toBeUndefined();
  });

  it('lists all registered plugins', () => {
    const { result } = renderHook(() => usePluginRegistry([mockPlugin, mockPlugin2]));
    expect(result.current.listAll()).toHaveLength(2);
  });

  it('unregisters a plugin', () => {
    const { result } = renderHook(() => usePluginRegistry([mockPlugin]));

    act(() => {
      result.current.unregister('test.plugin');
    });

    expect(result.current.getPlugin('test.plugin')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/hooks/__tests__/usePluginRegistry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement usePluginRegistry**

```typescript
// src/plugins/hooks/usePluginRegistry.ts

import { useRef, useCallback } from 'react';
import type { Plugin, ActionDefinition } from '../types';

export function usePluginRegistry(initialPlugins: Plugin[]) {
  const registryRef = useRef<Map<string, Plugin>>(new Map());

  // Initialize once
  if (registryRef.current.size === 0 && initialPlugins.length > 0) {
    for (const plugin of initialPlugins) {
      registryRef.current.set(plugin.id, plugin);
    }
  }

  const register = useCallback((plugin: Plugin) => {
    registryRef.current.set(plugin.id, plugin);
  }, []);

  const unregister = useCallback((pluginId: string) => {
    registryRef.current.delete(pluginId);
  }, []);

  const getPlugin = useCallback((pluginId: string): Plugin | undefined => {
    return registryRef.current.get(pluginId);
  }, []);

  const getAction = useCallback((pluginId: string, actionId: string): ActionDefinition | undefined => {
    const plugin = registryRef.current.get(pluginId);
    if (!plugin) return undefined;
    return plugin.actions.find(a => a.id === actionId);
  }, []);

  const listAll = useCallback((): Plugin[] => {
    return Array.from(registryRef.current.values());
  }, []);

  return { register, unregister, getPlugin, getAction, listAll };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/plugins/hooks/__tests__/usePluginRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/
git commit -m "feat(plugins): add usePluginRegistry hook"
```

---

## Wave 2: Execution Layer (Depends on Wave 1)

### Task 5: Built-in Plugins

**Files:**
- Create: `src/plugins/built-in/fullscreen.ts`
- Create: `src/plugins/built-in/navigation.ts`
- Create: `src/plugins/built-in/tabs.ts`
- Create: `src/plugins/built-in/clipboard.ts`
- Create: `src/plugins/built-in/speech.ts`
- Create: `src/plugins/built-in/notifications.ts`
- Create: `src/plugins/built-in/index.ts`

- [ ] **Step 1: Create fullscreen plugin**

```typescript
// src/plugins/built-in/fullscreen.ts

import type { Plugin } from '../types';

export const fullscreenPlugin: Plugin = {
  id: 'browser.fullscreen',
  name: 'Fullscreen',
  description: 'Toggle browser fullscreen mode',
  actions: [
    {
      id: 'toggle',
      description: 'Toggle fullscreen on or off',
      async execute() {
        try {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
            return { success: true, feedback: 'Exited fullscreen' };
          } else {
            await document.documentElement.requestFullscreen();
            return { success: true, feedback: 'Entered fullscreen' };
          }
        } catch (err) {
          return { success: false, feedback: `Fullscreen failed: ${(err as Error).message}` };
        }
      },
    },
  ],
};
```

- [ ] **Step 2: Create navigation plugin**

```typescript
// src/plugins/built-in/navigation.ts

import type { Plugin } from '../types';

export const navigationPlugin: Plugin = {
  id: 'dom.navigation',
  name: 'Navigation',
  description: 'Browser history navigation (back, forward, open URL)',
  actions: [
    {
      id: 'go-back',
      description: 'Navigate back in browser history',
      async execute() {
        window.history.back();
        return { success: true, feedback: 'Navigated back' };
      },
    },
    {
      id: 'go-forward',
      description: 'Navigate forward in browser history',
      async execute() {
        window.history.forward();
        return { success: true, feedback: 'Navigated forward' };
      },
    },
    {
      id: 'open-url',
      description: 'Open a URL in the current tab',
      params: [
        { name: 'url', type: 'string' as const, required: true, description: 'The URL to navigate to' },
      ],
      async execute(params) {
        const url = params.url as string;
        if (!url) return { success: false, feedback: 'No URL provided' };
        window.location.href = url;
        return { success: true, feedback: `Navigating to ${url}` };
      },
    },
  ],
};
```

- [ ] **Step 3: Create tabs plugin**

```typescript
// src/plugins/built-in/tabs.ts

import type { Plugin } from '../types';

export const tabsPlugin: Plugin = {
  id: 'dom.tabs',
  name: 'Tabs',
  description: 'Open and close browser tabs',
  actions: [
    {
      id: 'open-tab',
      description: 'Open a new browser tab',
      params: [
        { name: 'url', type: 'string' as const, required: false, description: 'URL to open (defaults to blank)' },
      ],
      async execute(params) {
        const url = (params.url as string) || 'about:blank';
        const win = window.open(url, '_blank');
        if (win) {
          return { success: true, feedback: `Opened new tab: ${url}` };
        }
        return { success: false, feedback: 'Popup blocked — allow popups for this site' };
      },
    },
    {
      id: 'close-tab',
      description: 'Close the current browser tab',
      async execute() {
        window.close();
        return { success: true, feedback: 'Closing tab' };
      },
    },
  ],
};
```

- [ ] **Step 4: Create clipboard plugin**

```typescript
// src/plugins/built-in/clipboard.ts

import type { Plugin } from '../types';

export const clipboardPlugin: Plugin = {
  id: 'browser.clipboard',
  name: 'Clipboard',
  description: 'Copy and paste text using the clipboard API',
  actions: [
    {
      id: 'copy-selection',
      description: 'Copy the current text selection to clipboard',
      async execute() {
        const selection = window.getSelection()?.toString() || '';
        if (!selection) return { success: false, feedback: 'No text selected' };
        try {
          await navigator.clipboard.writeText(selection);
          return { success: true, feedback: `Copied: "${selection.slice(0, 30)}..."`, data: selection };
        } catch {
          return { success: false, feedback: 'Clipboard access denied' };
        }
      },
    },
    {
      id: 'paste',
      description: 'Read text from clipboard',
      async execute() {
        try {
          const text = await navigator.clipboard.readText();
          return { success: true, feedback: `Clipboard: "${text.slice(0, 30)}..."`, data: text };
        } catch {
          return { success: false, feedback: 'Clipboard access denied' };
        }
      },
    },
  ],
};
```

- [ ] **Step 5: Create speech plugin**

```typescript
// src/plugins/built-in/speech.ts

import type { Plugin } from '../types';

export const speechPlugin: Plugin = {
  id: 'browser.speech',
  name: 'Speech',
  description: 'Text-to-speech using the Web Speech API',
  actions: [
    {
      id: 'speak-text',
      description: 'Speak text aloud using text-to-speech',
      params: [
        { name: 'text', type: 'string' as const, required: true, description: 'Text to speak' },
        { name: 'lang', type: 'string' as const, required: false, description: 'Language code (default: en-US)' },
      ],
      async execute(params) {
        const text = params.text as string;
        if (!text) return { success: false, feedback: 'No text provided' };
        if (!window.speechSynthesis) return { success: false, feedback: 'Speech synthesis not supported' };

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = (params.lang as string) || 'en-US';
        window.speechSynthesis.speak(utterance);
        return { success: true, feedback: `Speaking: "${text.slice(0, 30)}..."` };
      },
    },
  ],
};
```

- [ ] **Step 6: Create notifications plugin**

```typescript
// src/plugins/built-in/notifications.ts

import type { Plugin } from '../types';

export const notificationsPlugin: Plugin = {
  id: 'browser.notifications',
  name: 'Notifications',
  description: 'Show browser notifications',
  actions: [
    {
      id: 'show-notification',
      description: 'Display a browser notification',
      params: [
        { name: 'title', type: 'string' as const, required: true, description: 'Notification title' },
        { name: 'body', type: 'string' as const, required: false, description: 'Notification body text' },
      ],
      async execute(params) {
        const title = params.title as string;
        if (!title) return { success: false, feedback: 'No title provided' };

        if (!('Notification' in window)) {
          return { success: false, feedback: 'Notifications not supported' };
        }

        if (Notification.permission === 'denied') {
          return { success: false, feedback: 'Notifications permission denied' };
        }

        if (Notification.permission !== 'granted') {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') {
            return { success: false, feedback: 'Notifications permission denied' };
          }
        }

        new Notification(title, { body: (params.body as string) || '' });
        return { success: true, feedback: `Notification: ${title}` };
      },
    },
  ],
  async init() {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  },
};
```

- [ ] **Step 7: Create index barrel**

```typescript
// src/plugins/built-in/index.ts

export { fullscreenPlugin } from './fullscreen';
export { navigationPlugin } from './navigation';
export { tabsPlugin } from './tabs';
export { clipboardPlugin } from './clipboard';
export { speechPlugin } from './speech';
export { notificationsPlugin } from './notifications';
```

- [ ] **Step 8: Commit**

```bash
git add src/plugins/built-in/
git commit -m "feat(plugins): add 6 built-in plugins (fullscreen, navigation, tabs, clipboard, speech, notifications)"
```

---

### Task 6: ActionDispatcher Hook + Test

**Files:**
- Create: `src/plugins/hooks/useActionDispatcher.ts`
- Test: `src/plugins/hooks/__tests__/useActionDispatcher.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/plugins/hooks/__tests__/useActionDispatcher.test.ts

import { renderHook } from '@testing-library/react';
import { useActionDispatcher } from '../useActionDispatcher';
import type { Plugin, ActionIntent } from '../../types';

const mockPlugin: Plugin = {
  id: 'test.plugin',
  name: 'Test',
  description: 'Test plugin',
  actions: [
    {
      id: 'succeed',
      description: 'Always succeeds',
      execute: async () => ({ success: true, feedback: 'Done' }),
    },
    {
      id: 'fail',
      description: 'Always fails',
      execute: async () => { throw new Error('Boom'); },
    },
  ],
};

function makeRegistry() {
  return {
    getPlugin: (id: string) => id === 'test.plugin' ? mockPlugin : undefined,
    getAction: (pluginId: string, actionId: string) => {
      if (pluginId !== 'test.plugin') return undefined;
      return mockPlugin.actions.find(a => a.id === actionId);
    },
    register: () => {},
    unregister: () => {},
    listAll: () => [mockPlugin],
  };
}

describe('useActionDispatcher', () => {
  it('dispatches to the correct plugin action', async () => {
    const registry = makeRegistry();
    const { result } = renderHook(() => useActionDispatcher(registry));

    const intent: ActionIntent = { plugin: 'test.plugin', action: 'succeed' };
    const res = await result.current.dispatch(intent);

    expect(res.success).toBe(true);
    expect(res.feedback).toBe('Done');
  });

  it('returns error for unknown plugin', async () => {
    const registry = makeRegistry();
    const { result } = renderHook(() => useActionDispatcher(registry));

    const intent: ActionIntent = { plugin: 'nonexistent', action: 'foo' };
    const res = await result.current.dispatch(intent);

    expect(res.success).toBe(false);
    expect(res.feedback).toContain('Unknown');
  });

  it('returns error for unknown action', async () => {
    const registry = makeRegistry();
    const { result } = renderHook(() => useActionDispatcher(registry));

    const intent: ActionIntent = { plugin: 'test.plugin', action: 'nonexistent' };
    const res = await result.current.dispatch(intent);

    expect(res.success).toBe(false);
  });

  it('catches thrown errors from execute', async () => {
    const registry = makeRegistry();
    const { result } = renderHook(() => useActionDispatcher(registry));

    const intent: ActionIntent = { plugin: 'test.plugin', action: 'fail' };
    const res = await result.current.dispatch(intent);

    expect(res.success).toBe(false);
    expect(res.feedback).toContain('Boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/hooks/__tests__/useActionDispatcher.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement useActionDispatcher**

```typescript
// src/plugins/hooks/useActionDispatcher.ts

import { useCallback } from 'react';
import type { ActionIntent, ActionResult, ActionDefinition, Plugin } from '../types';

interface RegistryLike {
  getPlugin(pluginId: string): Plugin | undefined;
  getAction(pluginId: string, actionId: string): ActionDefinition | undefined;
}

export function useActionDispatcher(registry: RegistryLike) {
  const dispatch = useCallback(async (intent: ActionIntent): Promise<ActionResult> => {
    const plugin = registry.getPlugin(intent.plugin);
    if (!plugin) {
      return { success: false, feedback: `Unknown plugin: ${intent.plugin}` };
    }

    const action = registry.getAction(intent.plugin, intent.action);
    if (!action) {
      return { success: false, feedback: `Unknown action: ${intent.plugin}:${intent.action}` };
    }

    try {
      return await action.execute(intent.params || {});
    } catch (err) {
      return { success: false, feedback: (err as Error).message };
    }
  }, [registry]);

  return { dispatch };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/plugins/hooks/__tests__/useActionDispatcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/hooks/useActionDispatcher.ts src/plugins/hooks/__tests__/useActionDispatcher.test.ts
git commit -m "feat(plugins): add useActionDispatcher hook"
```

---

## Wave 3: Agent Layer (Depends on Wave 1 & 2)

### Task 7: MockAgentBridge

**Files:**
- Create: `src/agent/hooks/useAgentBridge.ts`

- [ ] **Step 1: Implement useAgentBridge**

```typescript
// src/agent/hooks/useAgentBridge.ts

import { useCallback, useMemo } from 'react';
import type { AgentBridge, InterpretRequest } from '../types';
import type { ActionIntent } from '../../plugins/types';

interface AgentBridgeConfig {
  enabled: boolean;
}

export function useAgentBridge(config: AgentBridgeConfig): AgentBridge {
  const interpret = useCallback(async (_request: InterpretRequest): Promise<ActionIntent | null> => {
    if (!config.enabled) return null;
    // Future: POST to /api/agent/interpret
    return null;
  }, [config.enabled]);

  const isAvailable = useCallback(() => config.enabled, [config.enabled]);

  return useMemo(() => ({ interpret, isAvailable }), [interpret, isAvailable]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/hooks/useAgentBridge.ts
git commit -m "feat(agent): add useAgentBridge hook (mock implementation)"
```

---

### Task 8: GestureInterpreter Hook + Test

**Files:**
- Create: `src/agent/hooks/useGestureInterpreter.ts`
- Test: `src/agent/hooks/__tests__/useGestureInterpreter.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/agent/hooks/__tests__/useGestureInterpreter.test.ts

import { renderHook, act } from '@testing-library/react';
import { useGestureInterpreter } from '../useGestureInterpreter';
import type { AgentGestureEvent, GestureMapping } from '../../types';

const mappings: GestureMapping[] = [
  { gesture: 'clap', action: 'browser.fullscreen:toggle' },
  { gesture: 'shake', action: 'dom.navigation:go-back' },
  { gesture: 'swipe-left', action: 'dom.navigation:go-back' },
];

function makeEvent(type: AgentGestureEvent['type']): AgentGestureEvent {
  return { type, hands: [], timestamp: Date.now() };
}

describe('useGestureInterpreter', () => {
  it('resolves a mapped gesture to an ActionIntent', () => {
    const onAction = vi.fn().mockResolvedValue({ success: true });
    const buffer = {
      push: vi.fn(),
      getSequence: vi.fn().mockReturnValue([]),
      getWindow: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    };
    const bridge = {
      interpret: vi.fn().mockResolvedValue(null),
      isAvailable: vi.fn().mockReturnValue(false),
    };

    const { result } = renderHook(() =>
      useGestureInterpreter({ mappings, buffer, bridge, onAction }),
    );

    act(() => {
      result.current.handle(makeEvent('clap'));
    });

    expect(onAction).toHaveBeenCalledWith({
      plugin: 'browser.fullscreen',
      action: 'toggle',
    });
  });

  it('does not call onAction for unmapped gesture', () => {
    const onAction = vi.fn();
    const buffer = {
      push: vi.fn(),
      getSequence: vi.fn().mockReturnValue([]),
      getWindow: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    };
    const bridge = {
      interpret: vi.fn().mockResolvedValue(null),
      isAvailable: vi.fn().mockReturnValue(false),
    };

    const { result } = renderHook(() =>
      useGestureInterpreter({ mappings, buffer, bridge, onAction }),
    );

    act(() => {
      result.current.handle(makeEvent('circular'));
    });

    expect(onAction).not.toHaveBeenCalled();
  });

  it('pushes every event to the context buffer', () => {
    const onAction = vi.fn().mockResolvedValue({ success: true });
    const buffer = {
      push: vi.fn(),
      getSequence: vi.fn().mockReturnValue([]),
      getWindow: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    };
    const bridge = {
      interpret: vi.fn().mockResolvedValue(null),
      isAvailable: vi.fn().mockReturnValue(false),
    };

    const { result } = renderHook(() =>
      useGestureInterpreter({ mappings, buffer, bridge, onAction }),
    );

    act(() => {
      result.current.handle(makeEvent('clap'));
    });

    expect(buffer.push).toHaveBeenCalledTimes(1);
  });

  it('parses plugin:action format correctly', () => {
    const onAction = vi.fn().mockResolvedValue({ success: true });
    const buffer = {
      push: vi.fn(),
      getSequence: vi.fn().mockReturnValue([]),
      getWindow: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    };
    const bridge = {
      interpret: vi.fn().mockResolvedValue(null),
      isAvailable: vi.fn().mockReturnValue(false),
    };

    const { result } = renderHook(() =>
      useGestureInterpreter({ mappings, buffer, bridge, onAction }),
    );

    act(() => {
      result.current.handle(makeEvent('shake'));
    });

    expect(onAction).toHaveBeenCalledWith({
      plugin: 'dom.navigation',
      action: 'go-back',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agent/hooks/__tests__/useGestureInterpreter.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement useGestureInterpreter**

```typescript
// src/agent/hooks/useGestureInterpreter.ts

import { useCallback } from 'react';
import type { AgentGestureEvent, GestureMapping, AgentBridge } from '../types';
import type { ActionIntent, ActionResult } from '../../plugins/types';

interface ContextBufferLike {
  push(event: AgentGestureEvent): void;
  getSequence(count: number): AgentGestureEvent[];
  getWindow(lastMs: number, now: number): AgentGestureEvent[];
}

interface GestureInterpreterConfig {
  mappings: GestureMapping[];
  buffer: ContextBufferLike;
  bridge: AgentBridge;
  onAction: (intent: ActionIntent) => Promise<ActionResult>;
}

function parseAction(actionStr: string): ActionIntent {
  const colonIndex = actionStr.indexOf(':');
  return {
    plugin: actionStr.slice(0, colonIndex),
    action: actionStr.slice(colonIndex + 1),
  };
}

export function useGestureInterpreter(config: GestureInterpreterConfig) {
  const { mappings, buffer, bridge, onAction } = config;

  const handle = useCallback((event: AgentGestureEvent) => {
    // Always record in context buffer
    buffer.push(event);

    // 1. Exact match against mappings
    const mapping = mappings.find(m => m.gesture === event.type);
    if (mapping) {
      const intent = parseAction(mapping.action);
      if (mapping.params) intent.params = mapping.params;
      onAction(intent);
      return;
    }

    // 2. No match — escalate to bridge if available
    if (bridge.isAvailable()) {
      const recentGestures = buffer.getSequence(10);
      bridge.interpret({
        currentGesture: event,
        recentGestures,
        availableActions: [],
      }).then(intent => {
        if (intent) onAction(intent);
      });
    }
  }, [mappings, buffer, bridge, onAction]);

  return { handle };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agent/hooks/__tests__/useGestureInterpreter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/hooks/useGestureInterpreter.ts src/agent/hooks/__tests__/useGestureInterpreter.test.ts
git commit -m "feat(agent): add useGestureInterpreter hook with mapping and escalation"
```

---

## Wave 4: Integration (Depends on Everything)

### Task 9: Modify useInteractionController

**Files:**
- Modify: `src/hooks/useInteractionController.ts`

- [ ] **Step 1: Add onGestureEvent parameter and emit events at detection points**

Add an optional `onGestureEvent` callback to `useInteractionController`. Emit `AgentGestureEvent` at each existing detection point:

1. Import `AgentGestureEvent` from `../agent/types`
2. Add `onGestureEvent?: (event: AgentGestureEvent) => void` parameter
3. Store it in a ref
4. Emit at: both-spread rising edge, both-pinch rising edge, pinch start, pinch release, shake triggered
5. Wire clap emission via `onClapRef` in App.tsx (not in this hook)

Detection points to add emit calls:
- Line ~212 (bothSpreadingRising): emit `{ type: 'both-spread', ... }`
- Line ~217 (bothPinchingRising): emit `{ type: 'both-pinch', ... }`
- Line ~284 (isPinching start): emit `{ type: 'pinch-start', ... }`
- Line ~306 (pinch release): emit `{ type: 'pinch-release', ... }`
- Line ~383 (shake triggered): emit `{ type: 'shake', ... }`

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useInteractionController.ts
git commit -m "feat(interaction): add onGestureEvent callback for agent layer integration"
```

---

### Task 10: ActionToast Component

**Files:**
- Create: `src/components/ActionToast.tsx`

- [ ] **Step 1: Create ActionToast component**

```typescript
// src/components/ActionToast.tsx

import { useState, useEffect, useCallback, memo } from 'react';
import type { ActionResult } from '../plugins/types';

interface ToastEntry {
  id: number;
  gesture: string;
  action: string;
  result: ActionResult;
  timestamp: number;
}

const TOAST_DURATION_MS = 2000;

function ActionToastInner() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  // Cleanup expired toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts(prev => prev.filter(t => now - t.timestamp < TOAST_DURATION_MS));
    }, 200);
    return () => clearInterval(timer);
  }, [toasts.length]);

  const addToast = useCallback((gesture: string, action: string, result: ActionResult) => {
    const entry: ToastEntry = {
      id: Date.now(),
      gesture,
      action,
      result,
      timestamp: Date.now(),
    };
    setToasts(prev => [...prev.slice(-4), entry]); // Keep max 5
  }, []);

  return { toasts, addToast };
}

export function useActionToast() {
  return ActionToastInner();
}

interface ActionToastDisplayProps {
  toasts: ToastEntry[];
}

export const ActionToastDisplay = memo(function ActionToastDisplay({ toasts }: ActionToastDisplayProps) {
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 80,
      right: 20,
      zIndex: 2000,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      pointerEvents: 'none',
    }}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          style={{
            background: toast.result.success ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
            color: 'white',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontFamily: 'monospace',
            backdropFilter: 'blur(8px)',
            animation: 'fadeInUp 200ms ease-out',
          }}
        >
          <strong>{toast.gesture}</strong> → {toast.result.feedback || toast.action}
        </div>
      ))}
    </div>
  );
});

export type { ToastEntry };
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ActionToast.tsx
git commit -m "feat(ui): add ActionToast component for gesture action feedback"
```

---

### Task 11: Wire Everything in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import new modules**

Add imports for: usePluginRegistry, useActionDispatcher, useAgentBridge, useContextBuffer, useGestureInterpreter, useActionToast, ActionToastDisplay, built-in plugins, default mappings.

- [ ] **Step 2: Add default mappings constant**

```typescript
import type { GestureMapping } from './agent/types';

const defaultMappings: GestureMapping[] = [
  { gesture: 'clap', action: 'browser.fullscreen:toggle' },
  { gesture: 'shake', action: 'dom.navigation:go-back' },
  { gesture: 'swipe-left', action: 'dom.navigation:go-back' },
  { gesture: 'swipe-right', action: 'dom.navigation:go-forward' },
  { gesture: 'both-spread', action: 'dom.tabs:close-tab' },
  { gesture: 'both-pinch', action: 'dom.tabs:open-tab' },
];
```

- [ ] **Step 3: Wire hooks in App component**

After existing hook calls, add:

```typescript
// --- Agent + Plugin hooks ---
const registry = usePluginRegistry([
  fullscreenPlugin, navigationPlugin, tabsPlugin,
  clipboardPlugin, speechPlugin, notificationsPlugin,
]);
const dispatcher = useActionDispatcher(registry);
const bridge = useAgentBridge({ enabled: false });
const buffer = useContextBuffer({ maxEvents: 50, maxMs: 10000 });
const { toasts, addToast } = useActionToast();

const handleAction = useCallback(async (intent: ActionIntent) => {
  const result = await dispatcher.dispatch(intent);
  addToast(intent.action, `${intent.plugin}:${intent.action}`, result);
  return result;
}, [dispatcher, addToast]);

const interpreter = useGestureInterpreter({
  mappings: defaultMappings,
  buffer,
  bridge,
  onAction: handleAction,
});
```

- [ ] **Step 4: Pass onGestureEvent to useInteractionController**

Wire `interpreter.handle` as the `onGestureEvent` callback.

- [ ] **Step 5: Add clap event emission in the clap handler**

In the existing `onClapRef.current = () => { ... }` block, add:
```typescript
interpreter.handle({ type: 'clap', hands: handsRef.current, timestamp: performance.now() });
```

- [ ] **Step 6: Add ActionToastDisplay to JSX**

Add `<ActionToastDisplay toasts={toasts} />` before the closing `</div>`.

- [ ] **Step 7: Add fadeInUp CSS animation to index.css**

```css
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/index.css
git commit -m "feat: wire agent layer and plugin system into App"
```

---

## Summary

| Wave | Tasks | Parallelizable | Depends On |
|------|-------|---------------|------------|
| 1 | Types (2), ContextBuffer, PluginRegistry | All 4 in parallel | Nothing |
| 2 | Built-in Plugins, ActionDispatcher | Both in parallel | Wave 1 |
| 3 | AgentBridge, GestureInterpreter | Both in parallel | Wave 1 + 2 |
| 4 | useInteractionController mod, ActionToast, App.tsx wiring | Sequential | All waves |
