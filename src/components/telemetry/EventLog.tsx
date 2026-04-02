import { useRef, useEffect } from 'react';
import type { TelemetryLogEntry } from '../../hooks/useTelemetryLogger';
import { PANEL } from '../../config';

interface EventLogProps {
  entries: TelemetryLogEntry[];
  onClear: () => void;
  onExport: () => void;
}

const EVENT_COLORS: Record<string, string> = {
  'velocity-spike': '#FF5F56',
  'shake': '#FF9500',
  'acceleration-burst': '#FFBD2E',
  'sudden-stop': '#4A90D9',
  'grip-change': '#27C93F',
  'motion-detected': '#c084fc',
  'snapshot': 'rgba(255,255,255,0.25)',
  // Spatial interaction events
  'hand-enter-element': '#4ECDC4',
  'hand-leave-element': '#95A5A6',
  'hand-hover': '#3498DB',
  'element-contact': '#E74C3C',
  'element-separate': '#BDC3C7',
  'proximity-alert': '#F39C12',
  'drag-snap': '#2ECC71',
};

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${Math.floor(d.getMilliseconds() / 100)}`;
}

export function EventLog({ entries, onClear, onExport }: EventLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  // Filter out snapshots for the visual log (too noisy)
  const visibleEntries = entries.filter((e) => e.type !== 'snapshot');

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', opacity: 0.5 }}>
          EVENT LOG ({visibleEntries.length})
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onExport} style={buttonStyle} title="Export JSON">EXP</button>
          <button onClick={onClear} style={buttonStyle} title="Clear log">CLR</button>
        </div>
      </div>
      <div ref={scrollRef} style={scrollStyle}>
        {visibleEntries.length === 0 && (
          <div style={{ opacity: 0.3, fontSize: 9, textAlign: 'center', padding: 8 }}>
            Waiting for hand events...
          </div>
        )}
        {visibleEntries.slice(-PANEL.EVENT_LOG_VISIBLE_ENTRIES).map((entry) => (
          <div key={entry.id} style={entryStyle}>
            <span style={{ color: 'rgba(255,255,255,0.3)', marginRight: 6, flexShrink: 0 }}>
              {formatTime(entry.timestamp)}
            </span>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: EVENT_COLORS[entry.type] ?? '#888',
              flexShrink: 0,
              marginRight: 6,
              marginTop: 3,
            }} />
            <span style={{ color: EVENT_COLORS[entry.type] ?? '#888' }}>
              {entry.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  width: PANEL.EVENT_LOG_WIDTH,
  background: 'rgba(0,0,0,0.78)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 10,
  color: 'rgba(255,255,255,0.85)',
  pointerEvents: 'auto',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const buttonStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 3,
  color: 'rgba(255,255,255,0.6)',
  cursor: 'pointer',
  fontSize: 8,
  fontFamily: 'inherit',
  padding: '2px 6px',
  letterSpacing: '0.03em',
};

const scrollStyle: React.CSSProperties = {
  maxHeight: PANEL.EVENT_LOG_MAX_HEIGHT,
  overflowY: 'auto',
  padding: '4px 10px 6px',
};

const entryStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  padding: '2px 0',
  lineHeight: 1.4,
};
