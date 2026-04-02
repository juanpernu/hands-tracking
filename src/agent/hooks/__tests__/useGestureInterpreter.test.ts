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

function makeMocks() {
  return {
    onAction: vi.fn().mockResolvedValue({ success: true }),
    buffer: {
      push: vi.fn(),
      getSequence: vi.fn().mockReturnValue([]),
      getWindow: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    },
    bridge: {
      interpret: vi.fn().mockResolvedValue(null),
      isAvailable: vi.fn().mockReturnValue(false),
    },
  };
}

describe('useGestureInterpreter', () => {
  it('resolves a mapped gesture to an ActionIntent', () => {
    const { onAction, buffer, bridge } = makeMocks();
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
    const { onAction, buffer, bridge } = makeMocks();
    const { result } = renderHook(() =>
      useGestureInterpreter({ mappings, buffer, bridge, onAction }),
    );

    act(() => {
      result.current.handle(makeEvent('circular'));
    });

    expect(onAction).not.toHaveBeenCalled();
  });

  it('pushes every event to the context buffer', () => {
    const { onAction, buffer, bridge } = makeMocks();
    const { result } = renderHook(() =>
      useGestureInterpreter({ mappings, buffer, bridge, onAction }),
    );

    act(() => {
      result.current.handle(makeEvent('clap'));
    });

    expect(buffer.push).toHaveBeenCalledTimes(1);
  });

  it('parses plugin:action format correctly', () => {
    const { onAction, buffer, bridge } = makeMocks();
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

  it('throws on malformed action string (no colon)', () => {
    const { onAction, buffer, bridge } = makeMocks();
    const badMappings: GestureMapping[] = [
      { gesture: 'clap', action: 'nocolonhere' },
    ];
    const { result } = renderHook(() =>
      useGestureInterpreter({ mappings: badMappings, buffer, bridge, onAction }),
    );

    expect(() => {
      result.current.handle(makeEvent('clap'));
    }).toThrow('Invalid action format');
  });

  it('escalates to bridge when available and no mapping found', async () => {
    const { onAction, buffer, bridge } = makeMocks();
    bridge.isAvailable.mockReturnValue(true);
    bridge.interpret.mockResolvedValue({ plugin: 'test', action: 'foo' });

    const { result } = renderHook(() =>
      useGestureInterpreter({ mappings, buffer, bridge, onAction }),
    );

    act(() => {
      result.current.handle(makeEvent('circular'));
    });

    // Wait for async bridge call
    await vi.waitFor(() => {
      expect(bridge.interpret).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      expect(onAction).toHaveBeenCalledWith({ plugin: 'test', action: 'foo' });
    });
  });
});
