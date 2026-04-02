import { useState, useEffect, useCallback, memo } from 'react';
import type { ActionResult } from '../plugins/types';

interface ToastEntry {
  id: number;
  gesture: string;
  action: string;
  result: ActionResult;
  timestamp: number;
}

const TOAST_DURATION_MS = 2000;

export function useActionToast() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts(prev => prev.filter(t => now - t.timestamp < TOAST_DURATION_MS));
    }, 200);
    return () => clearInterval(timer);
  }, [toasts.length]);

  const addToast = useCallback((gesture: string, action: string, result: ActionResult) => {
    const entry: ToastEntry = {
      id: Date.now(),
      gesture,
      action,
      result,
      timestamp: Date.now(),
    };
    setToasts(prev => [...prev.slice(-4), entry]);
  }, []);

  return { toasts, addToast };
}

interface ActionToastDisplayProps {
  toasts: ToastEntry[];
}

export const ActionToastDisplay = memo(function ActionToastDisplay({ toasts }: ActionToastDisplayProps) {
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 80,
      right: 20,
      zIndex: 2000,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      pointerEvents: 'none',
    }}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          style={{
            background: toast.result.success ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
            color: 'white',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontFamily: 'monospace',
            backdropFilter: 'blur(8px)',
            animation: 'fadeInUp 200ms ease-out',
          }}
        >
          <strong>{toast.gesture}</strong> → {toast.result.feedback || toast.action}
        </div>
      ))}
    </div>
  );
});

export type { ToastEntry };
