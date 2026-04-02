import { memo, useRef, useEffect, useState } from 'react';
import type { HandSpatialState, SpatialEvent, SpatialEventType } from '../../types/spatial';

interface SpatialHUDProps {
  handSpatialRef: React.MutableRefObject<{
    left: HandSpatialState | null;
    right: HandSpatialState | null;
  }>;
  spatialEvents: SpatialEvent[];
}

interface SpatialSnapshot {
  left: HandSpatialState | null;
  right: HandSpatialState | null;
}

const EVENT_DOT_COLORS: Record<SpatialEventType, string> = {
  'hand-enter-element': '#4ECDC4',
  'hand-leave-element': '#95A5A6',
  'element-contact': '#E74C3C',
  'element-separate': '#BDC3C7',
  'proximity-alert': '#F39C12',
  'drag-snap': '#2ECC71',
  'hand-hover': '#3498DB',
};

function formatHoverDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncateSelector(selector: string, maxLen = 22): string {
  return selector.length > maxLen ? selector.slice(0, maxLen - 1) + '…' : selector;
}

function formatEventDetail(event: SpatialEvent): string {
  const parts: string[] = [];
  if (event.handedness) parts.push(event.handedness === 'Left' ? 'L' : 'R');
  if (event.target) parts.push(truncateSelector(event.target, 18));
  const detail = event.detail;
  if (typeof detail['distance'] === 'number') {
    parts.push(`${(detail['distance'] as number).toFixed(0)}px`);
  }
  if (typeof detail['overlapRatioA'] === 'number') {
    parts.push(`${Math.round((detail['overlapRatioA'] as number) * 100)}%`);
  }
  if (parts.length === 0) return event.type;
  return parts.join(' ');
}

function HandSection({
  state,
  label,
  labelColor,
}: {
  state: HandSpatialState | null;
  label: string;
  labelColor: string;
}) {
  return (
    <div style={handSectionStyle}>
      <div style={{ ...handLabelStyle, color: labelColor }}>{label}</div>
      {state === null ? (
        <div style={noHandStyle}>no hand</div>
      ) : (
        <>
          <div style={dataRowStyle}>
            <span style={dataLabelStyle}>target</span>
            <span
              style={{
                color: state.hoverTarget?.isInteractive ? '#F7DC6F' : '#888',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 90,
              }}
            >
              {state.hoverTarget ? truncateSelector(state.hoverTarget.selector, 14) : '—'}
            </span>
          </div>
          <div style={dataRowStyle}>
            <span style={dataLabelStyle}>score</span>
            <span style={{ color: 'rgba(255,255,255,0.85)' }}>
              {state.hoverTarget ? state.hoverTarget.relevanceScore.toFixed(1) : '—'}
            </span>
          </div>
          <div style={dataRowStyle}>
            <span style={dataLabelStyle}>hover</span>
            <span style={{ color: state.hoverDurationMs > 0 ? '#F39C12' : 'rgba(255,255,255,0.4)' }}>
              {state.hoverDurationMs > 0 ? formatHoverDuration(state.hoverDurationMs) : '—'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function EventFeed({ events }: { events: SpatialEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const visible = events.slice(-20);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div ref={scrollRef} style={feedScrollStyle}>
      {visible.length === 0 ? (
        <div style={feedEmptyStyle}>no events yet</div>
      ) : (
        visible.map((ev, i) => {
          const dotColor = EVENT_DOT_COLORS[ev.type] ?? '#888';
          return (
            <div key={`${ev.timestamp}-${i}`} style={feedEntryStyle}>
              <span style={{ ...dotStyle, backgroundColor: dotColor }} />
              <span style={{ color: dotColor }}>
                {formatEventDetail(ev)}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

export const SpatialHUD = memo(function SpatialHUD({ handSpatialRef, spatialEvents }: SpatialHUDProps) {
  const [snapshot, setSnapshot] = useState<SpatialSnapshot>({ left: null, right: null });

  useEffect(() => {
    const id = setInterval(() => {
      const { left, right } = handSpatialRef.current;
      setSnapshot({ left, right });
    }, 100);
    return () => clearInterval(id);
  }, [handSpatialRef]);

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={sectionHeaderStyle}>SPATIAL</div>

      {/* Dual hand row */}
      <div style={dualHandRowStyle}>
        <HandSection state={snapshot.right} label="R HAND" labelColor="#4ECDC4" />
        <div style={handDividerStyle} />
        <HandSection state={snapshot.left} label="L HAND" labelColor="#FF6B6B" />
      </div>

      {/* Event feed */}
      <div style={feedHeaderStyle}>
        <span style={feedLabelStyle}>EVENTS ({spatialEvents.slice(-20).length})</span>
      </div>
      <EventFeed events={spatialEvents} />
    </div>
  );
});

// --- Styles ---

const containerStyle: React.CSSProperties = {
  width: 280,
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 11,
  color: '#ccc',
  background: 'rgba(0,0,0,0.85)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  padding: 10,
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: 'rgba(255,255,255,0.45)',
  marginBottom: 6,
};

const dualHandRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 0,
  borderTop: '1px solid rgba(255,255,255,0.08)',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  marginBottom: 0,
};

const handSectionStyle: React.CSSProperties = {
  flex: 1,
  padding: '5px 0',
  minWidth: 0,
};

const handDividerStyle: React.CSSProperties = {
  width: 1,
  background: 'rgba(255,255,255,0.08)',
  margin: '0 8px',
  flexShrink: 0,
};

const handLabelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.05em',
  marginBottom: 3,
};

const noHandStyle: React.CSSProperties = {
  color: '#555',
  fontSize: 10,
  paddingTop: 2,
};

const dataRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  lineHeight: 1.55,
  minWidth: 0,
};

const dataLabelStyle: React.CSSProperties = {
  opacity: 0.45,
  marginRight: 4,
  flexShrink: 0,
};

const feedHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  borderTop: '1px solid rgba(255,255,255,0.08)',
  paddingTop: 5,
  marginTop: 5,
  marginBottom: 3,
};

const feedLabelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.05em',
  color: 'rgba(255,255,255,0.4)',
};

const feedScrollStyle: React.CSSProperties = {
  maxHeight: 120,
  overflowY: 'auto',
};

const feedEmptyStyle: React.CSSProperties = {
  opacity: 0.3,
  fontSize: 9,
  textAlign: 'center',
  padding: '6px 0',
};

const feedEntryStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '1px 0',
  lineHeight: 1.45,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
};

const dotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  flexShrink: 0,
  display: 'inline-block',
};
