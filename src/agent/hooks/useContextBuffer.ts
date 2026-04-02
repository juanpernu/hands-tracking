import { useRef, useCallback } from 'react';
import type { AgentGestureEvent } from '../types';

interface ContextBufferConfig {
  maxEvents: number;
  maxMs: number;
}

export function useContextBuffer(config: ContextBufferConfig) {
  const bufferRef = useRef<AgentGestureEvent[]>([]);
  const headRef = useRef(0);
  const sizeRef = useRef(0);
  const capacityRef = useRef(0);

  if (capacityRef.current !== config.maxEvents) {
    bufferRef.current = new Array(config.maxEvents).fill(null);
    headRef.current = 0;
    sizeRef.current = 0;
    capacityRef.current = config.maxEvents;
  }

  const push = useCallback((event: AgentGestureEvent) => {
    bufferRef.current[headRef.current] = event;
    headRef.current = (headRef.current + 1) % config.maxEvents;
    if (sizeRef.current < config.maxEvents) sizeRef.current++;
  }, [config.maxEvents]);

  const getSequence = useCallback((count: number): AgentGestureEvent[] => {
    const size = sizeRef.current;
    const n = Math.min(count, size);
    const result: AgentGestureEvent[] = [];
    const start = size < config.maxEvents ? 0 : headRef.current;
    const skip = size - n;
    for (let i = skip; i < size; i++) {
      result.push(bufferRef.current[(start + i) % config.maxEvents]);
    }
    return result;
  }, [config.maxEvents]);

  const getWindow = useCallback((lastMs: number, now: number): AgentGestureEvent[] => {
    const cutoff = now - lastMs;
    const size = sizeRef.current;
    const start = size < config.maxEvents ? 0 : headRef.current;
    const result: AgentGestureEvent[] = [];
    for (let i = 0; i < size; i++) {
      const event = bufferRef.current[(start + i) % config.maxEvents];
      if (event && event.timestamp >= cutoff) result.push(event);
    }
    return result;
  }, [config.maxEvents]);

  const clear = useCallback(() => {
    bufferRef.current.fill(null as unknown as AgentGestureEvent);
    headRef.current = 0;
    sizeRef.current = 0;
  }, []);

  return { push, getSequence, getWindow, clear };
}
