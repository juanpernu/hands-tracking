import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useContextBuffer } from '../useContextBuffer';
import type { AgentGestureEvent } from '../../types';

function makeEvent(type: AgentGestureEvent['type'], timestamp: number): AgentGestureEvent {
  return {
    type,
    hands: [],
    timestamp,
  };
}

describe('useContextBuffer', () => {
  it('should push and retrieve events', () => {
    const { result } = renderHook(() =>
      useContextBuffer({ maxEvents: 5, maxMs: 5000 })
    );

    act(() => {
      result.current.push(makeEvent('pinch-start', 1000));
      result.current.push(makeEvent('pinch-release', 2000));
    });

    const seq = result.current.getSequence(2);
    expect(seq).toHaveLength(2);
    expect(seq[0].type).toBe('pinch-start');
    expect(seq[1].type).toBe('pinch-release');
  });

  it('should handle ring buffer overflow (maxEvents=3, push 4)', () => {
    const { result } = renderHook(() =>
      useContextBuffer({ maxEvents: 3, maxMs: 5000 })
    );

    act(() => {
      result.current.push(makeEvent('pinch-start', 1000));
      result.current.push(makeEvent('pinch-release', 2000));
      result.current.push(makeEvent('swipe-left', 3000));
      result.current.push(makeEvent('swipe-right', 4000));
    });

    const seq = result.current.getSequence(3);
    expect(seq).toHaveLength(3);
    // First event should be overwritten
    expect(seq[0].type).toBe('pinch-release');
    expect(seq[1].type).toBe('swipe-left');
    expect(seq[2].type).toBe('swipe-right');
  });

  it('should filter events by time window', () => {
    const { result } = renderHook(() =>
      useContextBuffer({ maxEvents: 10, maxMs: 5000 })
    );

    act(() => {
      result.current.push(makeEvent('pinch-start', 1000));
      result.current.push(makeEvent('pinch-release', 3000));
      result.current.push(makeEvent('swipe-left', 5000));
    });

    const window = result.current.getWindow(3000, 5500);
    expect(window).toHaveLength(2);
    expect(window[0].type).toBe('pinch-release');
    expect(window[1].type).toBe('swipe-left');
  });

  it('getSequence clamps when requesting more than buffer holds', () => {
    const { result } = renderHook(() => useContextBuffer({ maxEvents: 50, maxMs: 10000 }));
    act(() => {
      result.current.push(makeEvent('clap', 1000));
      result.current.push(makeEvent('shake', 2000));
    });
    expect(result.current.getSequence(100)).toHaveLength(2);
  });

  it('getWindow works on a full wrapped ring buffer', () => {
    const { result } = renderHook(() => useContextBuffer({ maxEvents: 3, maxMs: 10000 }));
    act(() => {
      result.current.push(makeEvent('clap', 1000));
      result.current.push(makeEvent('shake', 2000));
      result.current.push(makeEvent('both-pinch', 3000));
      result.current.push(makeEvent('both-spread', 4000)); // overwrites slot 0
      result.current.push(makeEvent('pinch-start', 5000)); // overwrites slot 1
    });
    const window = result.current.getWindow(3000, 5500);
    expect(window).toHaveLength(3);
    expect(window[0].type).toBe('both-pinch');
    expect(window[2].type).toBe('pinch-start');
  });

  it('push after clear returns only new events', () => {
    const { result } = renderHook(() => useContextBuffer({ maxEvents: 50, maxMs: 10000 }));
    act(() => {
      result.current.push(makeEvent('clap', 1000));
      result.current.push(makeEvent('shake', 2000));
      result.current.clear();
      result.current.push(makeEvent('both-pinch', 3000));
    });
    const seq = result.current.getSequence(10);
    expect(seq).toHaveLength(1);
    expect(seq[0].type).toBe('both-pinch');
  });

  it('should clear the buffer', () => {
    const { result } = renderHook(() =>
      useContextBuffer({ maxEvents: 5, maxMs: 5000 })
    );

    act(() => {
      result.current.push(makeEvent('pinch-start', 1000));
      result.current.push(makeEvent('pinch-release', 2000));
    });

    act(() => {
      result.current.clear();
    });

    const seq = result.current.getSequence(10);
    expect(seq).toHaveLength(0);
  });
});
