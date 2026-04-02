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
    expect(res.feedback).toContain('Unknown plugin');
  });

  it('returns error for unknown action', async () => {
    const registry = makeRegistry();
    const { result } = renderHook(() => useActionDispatcher(registry));
    const intent: ActionIntent = { plugin: 'test.plugin', action: 'nonexistent' };
    const res = await result.current.dispatch(intent);
    expect(res.success).toBe(false);
    expect(res.feedback).toContain('Unknown action');
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
