import { useRef, useState, useCallback, useEffect } from 'react';
import { OLLAMA } from '../../config';
import type { OllamaResponse, ActionIntent } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface UseOllamaStreamOptions {
  model?: string;
  baseUrl?: string;
  systemPrompt: string;
  keepAliveMs?: number;
  enabled?: boolean;
}

export interface UseOllamaStreamReturn {
  send: (message: string) => void;
  onResponse: React.MutableRefObject<((response: OllamaResponse) => void) | null>;
  isConnected: boolean;
  reconnect: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RECONNECT_BASE_MS = OLLAMA.RECONNECT_BASE_MS;
const RECONNECT_MAX_MS = OLLAMA.RECONNECT_MAX_MS;

function parseResponse(raw: string): OllamaResponse {
  const trimmed = raw.trim();

  if (trimmed === '_') {
    return { type: 'silence' };
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as ActionIntent;
      if (parsed.plugin && parsed.action) {
        return { type: 'action', intent: parsed };
      }
      return { type: 'error', message: `unexpected response: ${trimmed}` };
    } catch {
      return { type: 'error', message: `unexpected response: ${trimmed}` };
    }
  }

  return { type: 'error', message: `unexpected response: ${trimmed}` };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOllamaStream(options: UseOllamaStreamOptions): UseOllamaStreamReturn {
  const {
    model = OLLAMA.MODEL,
    baseUrl = OLLAMA.BASE_URL,
    systemPrompt,
    keepAliveMs = OLLAMA.KEEP_ALIVE_MS,
    enabled = true,
  } = options;

  // --- State (only isConnected triggers re-renders) ---
  const [isConnected, setIsConnected] = useState(false);

  // --- Refs ---
  const messagesRef = useRef<ChatMessage[]>([]);
  const inflightRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const onResponse = useRef<((response: OllamaResponse) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(RECONNECT_BASE_MS);
  const mountedRef = useRef(true);

  // --- Health check ---
  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }, [baseUrl]);

  // --- Reconnect with exponential backoff ---
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return; // already scheduled

    reconnectTimerRef.current = setTimeout(async () => {
      reconnectTimerRef.current = null;
      if (!mountedRef.current) return;

      const healthy = await checkHealth();
      if (healthy) {
        setIsConnected(true);
        backoffRef.current = RECONNECT_BASE_MS;
      } else {
        backoffRef.current = Math.min(backoffRef.current * 2, RECONNECT_MAX_MS);
        scheduleReconnect();
      }
    }, backoffRef.current);
  }, [checkHealth]);

  // --- Reconnect (public) ---
  const reconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    backoffRef.current = RECONNECT_BASE_MS;
    setIsConnected(false);

    void checkHealth().then((healthy) => {
      if (!mountedRef.current) return;
      if (healthy) {
        setIsConnected(true);
      } else {
        scheduleReconnect();
      }
    });
  }, [checkHealth, scheduleReconnect]);

  // --- Send ---
  const send = useCallback(
    (message: string) => {
      // Debounce: if in-flight, store as pending
      if (inflightRef.current) {
        pendingRef.current = message;
        return;
      }

      inflightRef.current = true;

      // Add user message to history
      messagesRef.current.push({ role: 'user', content: message });

      // Create abort controller for this request
      const controller = new AbortController();
      abortRef.current = controller;

      const keepAliveStr = `${Math.round(keepAliveMs / 60_000)}m`;

      void (async () => {
        try {
          const res = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              system: systemPrompt,
              messages: messagesRef.current,
              stream: true,
              keep_alive: keepAliveStr,
              options: { temperature: 0 },
            }),
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            inflightRef.current = false;
            if (!isConnected) return;
            setIsConnected(false);
            scheduleReconnect();
            return;
          }

          // Mark connected on successful response
          if (!isConnected) {
            setIsConnected(true);
            backoffRef.current = RECONNECT_BASE_MS;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = '';

          for (;;) {
            const { done: readerDone, value } = await reader.read();
            if (readerDone) break;

            const text = decoder.decode(value, { stream: true });
            // Each line is a JSON object
            const lines = text.split('\n').filter(Boolean);
            for (const line of lines) {
              try {
                const chunk = JSON.parse(line) as {
                  message?: { role: string; content: string };
                  done: boolean;
                };
                if (chunk.message?.content) {
                  accumulated += chunk.message.content;
                }
              } catch {
                // skip malformed lines
              }
            }
          }

          // Add assistant response to history
          messagesRef.current.push({ role: 'assistant', content: accumulated });

          // Trim to rolling window
          if (messagesRef.current.length > OLLAMA.MAX_CONTEXT_MESSAGES) {
            messagesRef.current = messagesRef.current.slice(
              messagesRef.current.length - OLLAMA.MAX_CONTEXT_MESSAGES,
            );
          }

          // Parse and dispatch
          const parsed = parseResponse(accumulated);
          inflightRef.current = false;

          // Send pending message if any
          if (pendingRef.current) {
            const pending = pendingRef.current;
            pendingRef.current = null;
            send(pending);
          }

          onResponse.current?.(parsed);
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            // Intentional abort (unmount) — do nothing
            return;
          }
          inflightRef.current = false;
          if (mountedRef.current) {
            setIsConnected(false);
            scheduleReconnect();
          }
        }
      })();
    },
    [baseUrl, model, systemPrompt, keepAliveMs, isConnected, scheduleReconnect, send],
  );

  // --- Mount / unmount ---
  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      void checkHealth().then((healthy) => {
        if (!mountedRef.current) return;
        if (healthy) {
          setIsConnected(true);
        } else {
          setIsConnected(false);
          scheduleReconnect();
        }
      });
    }

    return () => {
      mountedRef.current = false;

      // Abort in-flight fetch
      abortRef.current?.abort();
      abortRef.current = null;

      // Clear reconnect timer
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      // Clear messages
      messagesRef.current = [];
      inflightRef.current = false;
      pendingRef.current = null;
    };
  }, [enabled, checkHealth, scheduleReconnect]);

  return { send, onResponse, isConnected, reconnect };
}
