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
