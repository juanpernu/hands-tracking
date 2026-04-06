import { useCallback, useMemo } from 'react';
import { useOllamaStream } from './useOllamaStream';
import { buildSystemPrompt, formatGestureMessage } from '../ollama-config';
import type { AgentBridge, InterpretRequest, OllamaResponse } from '../types';
import type { ActionDefinition, ActionIntent } from '../../plugins/types';
import type { HandSpatialState } from '../../types/spatial';

export interface AgentBridgeConfig {
  enabled: boolean;
  actions?: ActionDefinition[];
  spatialRef?: React.MutableRefObject<{ left: HandSpatialState | null; right: HandSpatialState | null }>;
  onAction?: React.MutableRefObject<((intent: ActionIntent) => void) | null>;
}

export function useAgentBridge(config: AgentBridgeConfig): AgentBridge {
  const systemPrompt = useMemo(
    () => config.actions ? buildSystemPrompt(config.actions) : '',
    [config.actions],
  );

  const stream = useOllamaStream({
    systemPrompt,
    enabled: config.enabled,
  });

  // Wire LLM responses to action callback
  stream.onResponse.current = useCallback((response: OllamaResponse) => {
    if (response.type === 'action') {
      config.onAction?.current?.(response.intent);
    }
  }, [config.onAction]);

  const interpret = useCallback(async (request: InterpretRequest): Promise<ActionIntent | null> => {
    if (!config.enabled || !stream.isConnected) return null;
    const spatial = config.spatialRef?.current;
    const message = formatGestureMessage(request.currentGesture, spatial);
    stream.send(message);
    return null; // response comes async via onResponse
  }, [config.enabled, config.spatialRef, stream]);

  const isAvailable = useCallback(() => config.enabled && stream.isConnected, [config.enabled, stream.isConnected]);

  return useMemo(() => ({ interpret, isAvailable }), [interpret, isAvailable]);
}
