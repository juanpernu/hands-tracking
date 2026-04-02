import { useRef, useCallback } from 'react';
import type { Plugin, ActionDefinition } from '../types';

export function usePluginRegistry(initialPlugins: Plugin[]) {
  const registryRef = useRef<Map<string, Plugin>>(new Map());

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
