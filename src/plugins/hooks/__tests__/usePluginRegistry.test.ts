import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { usePluginRegistry } from '../usePluginRegistry';
import type { Plugin } from '../../types';

function makePlugin(id: string, actionIds: string[] = []): Plugin {
  return {
    id,
    name: `Plugin ${id}`,
    description: `Description for ${id}`,
    actions: actionIds.map(actionId => ({
      id: actionId,
      description: `Action ${actionId}`,
      execute: async () => ({ success: true }),
    })),
  };
}

describe('usePluginRegistry', () => {
  it('should register initial plugins', () => {
    const plugins = [makePlugin('p1'), makePlugin('p2')];
    const { result } = renderHook(() => usePluginRegistry(plugins));

    expect(result.current.listAll()).toHaveLength(2);
    expect(result.current.getPlugin('p1')).toBeDefined();
    expect(result.current.getPlugin('p2')).toBeDefined();
  });

  it('should dynamically register a plugin', () => {
    const { result } = renderHook(() => usePluginRegistry([]));

    act(() => {
      result.current.register(makePlugin('dynamic'));
    });

    expect(result.current.getPlugin('dynamic')).toBeDefined();
    expect(result.current.listAll()).toHaveLength(1);
  });

  it('should return undefined for unknown plugin', () => {
    const { result } = renderHook(() => usePluginRegistry([]));

    expect(result.current.getPlugin('nonexistent')).toBeUndefined();
  });

  it('should find an action by plugin and action id', () => {
    const plugins = [makePlugin('p1', ['act1', 'act2'])];
    const { result } = renderHook(() => usePluginRegistry(plugins));

    const action = result.current.getAction('p1', 'act2');
    expect(action).toBeDefined();
    expect(action!.id).toBe('act2');
  });

  it('should return undefined for unknown action', () => {
    const plugins = [makePlugin('p1', ['act1'])];
    const { result } = renderHook(() => usePluginRegistry(plugins));

    expect(result.current.getAction('p1', 'nonexistent')).toBeUndefined();
    expect(result.current.getAction('unknown', 'act1')).toBeUndefined();
  });

  it('should list all registered plugins', () => {
    const plugins = [makePlugin('a'), makePlugin('b'), makePlugin('c')];
    const { result } = renderHook(() => usePluginRegistry(plugins));

    const all = result.current.listAll();
    expect(all).toHaveLength(3);
    const ids = all.map(p => p.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
  });

  it('should unregister a plugin', () => {
    const plugins = [makePlugin('p1'), makePlugin('p2')];
    const { result } = renderHook(() => usePluginRegistry(plugins));

    act(() => {
      result.current.unregister('p1');
    });

    expect(result.current.getPlugin('p1')).toBeUndefined();
    expect(result.current.listAll()).toHaveLength(1);
  });
});
