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
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, feedback: message || 'Unknown error' };
    }
  }, [registry]);

  return { dispatch };
}
