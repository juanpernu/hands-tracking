import { useCallback, useRef, useMemo } from 'react';
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
  if (colonIndex === -1) {
    throw new Error(
      `Invalid action format "${actionStr}": expected "pluginId:actionId"`
    );
  }
  return {
    plugin: actionStr.slice(0, colonIndex),
    action: actionStr.slice(colonIndex + 1),
  };
}

export function useGestureInterpreter(config: GestureInterpreterConfig) {
  const { mappings, buffer, bridge, onAction } = config;

  const mappingsRef = useRef(mappings);
  mappingsRef.current = mappings;
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const pendingBridgeRef = useRef(false);

  const handle = useCallback((event: AgentGestureEvent) => {
    // Always record in context buffer
    buffer.push(event);

    // 1. Exact match against mappings
    const mapping = mappingsRef.current.find(m => m.gesture === event.type);
    if (mapping) {
      const intent = parseAction(mapping.action);
      if (mapping.params) intent.params = { ...mapping.params };
      onActionRef.current(intent).catch(err => {
        console.warn('[GestureInterpreter] action failed:', err);
      });
      return;
    }

    // 2. No match — escalate to bridge if available
    if (bridge.isAvailable() && !pendingBridgeRef.current) {
      pendingBridgeRef.current = true;
      const recentGestures = buffer.getSequence(10);
      bridge.interpret({
        currentGesture: event,
        recentGestures,
        availableActions: [],
      }).then(intent => {
        if (intent) {
          onActionRef.current(intent).catch(err => {
            console.warn('[GestureInterpreter] bridge action failed:', err);
          });
        }
      }).catch(err => {
        console.warn('[GestureInterpreter] bridge interpret failed:', err);
      }).finally(() => {
        pendingBridgeRef.current = false;
      });
    }
  }, [buffer, bridge]);

  return useMemo(() => ({ handle }), [handle]);
}
