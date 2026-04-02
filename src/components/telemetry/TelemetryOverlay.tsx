import React, { useEffect } from 'react';

interface TelemetryOverlayProps {
  visible: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function TelemetryOverlay({ visible, onToggle, children }: TelemetryOverlayProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'T' || e.key === 't') {
        onToggle();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggle]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1100,
      }}
    >
      {children}
    </div>
  );
}

export default TelemetryOverlay;
