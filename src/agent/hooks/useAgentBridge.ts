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
