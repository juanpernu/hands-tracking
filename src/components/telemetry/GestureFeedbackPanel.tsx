import { memo, useState, useRef, useEffect } from 'react';

// --- Types ---

export interface GestureFeedbackEntry {
  id: number;
  gesture: string;
  timestamp: number;
  spatial?: string;
  feedback?: 'correct' | 'incorrect';
  correction?: string;
}

interface GestureFeedbackPanelProps {
  entries: GestureFeedbackEntry[];
  onConfirm: (id: number) => void;
  onCorrect: (id: number, correctGesture: string) => void;
}

// --- Constants ---

const GESTURE_COLORS: Record<string, string> = {
  'tap': '#4ECDC4',
  'pinch-start': '#4A90D9',
  'pinch-release': '#4A90D9',
  'both-pinch': '#FFA07A',
  'both-spread': '#FF6B6B',
  'swipe-left': '#F7DC6F',
  'swipe-right': '#F7DC6F',
  'swipe-up': '#F7DC6F',
  'swipe-down': '#F7DC6F',
  'clap': '#98D8C8',
  'shake': '#E74C3C',
  'circular': '#9B59B6',
  'grip-change': '#888',
};

const CORRECTION_OPTIONS = [
  'tap',
  'pinch',
  'swipe-left',
  'swipe-right',
  'swipe-up',
  'swipe-down',
  'clap',
  'shake',
  'circular',
  'none',
] as const;

// --- Helpers ---

function formatRelativeTime(timestamp: number): string {
  const deltaMs = performance.now() - timestamp;
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m`;
}

function getGestureColor(gesture: string): string {
  return GESTURE_COLORS[gesture] ?? '#888';
}

// --- Sub-components ---

interface GestureRowProps {
  entry: GestureFeedbackEntry;
  expandedId: number | null;
  onConfirm: (id: number) => void;
  onCorrect: (id: number, correctGesture: string) => void;
  onToggleExpand: (id: number) => void;
  now: number;
}

function GestureRow({ entry, expandedId, onConfirm, onCorrect, onToggleExpand, now }: GestureRowProps) {
  const [hovered, setHovered] = useState(false);
  const isExpanded = expandedId === entry.id;

  const dotColor = entry.feedback === 'correct'
    ? '#2ECC71'
    : entry.feedback === 'incorrect'
    ? '#E74C3C'
    : getGestureColor(entry.gesture);

  const relativeTime = formatRelativeTime(entry.timestamp);
  // re-compute relative time on each render driven by parent's `now` ticker
  void now;

  let leftBorderColor = 'transparent';
  if (entry.feedback === 'correct') leftBorderColor = '#2ECC71';
  else if (entry.feedback === 'incorrect') leftBorderColor = '#E74C3C';

  return (
    <div style={{ borderLeft: `2px solid ${leftBorderColor}`, marginBottom: 1 }}>
      {/* Main row */}
      <div
        style={{ ...rowStyle, paddingLeft: 6 }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Dot */}
        <span style={{ ...dotStyle, backgroundColor: dotColor }} />

        {/* Gesture name */}
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: entry.feedback === 'incorrect' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.85)',
            textDecoration: entry.feedback === 'incorrect' ? 'line-through' : 'none',
          }}
        >
          {entry.gesture}
        </span>

        {/* Correction label */}
        {entry.feedback === 'incorrect' && entry.correction && (
          <span style={correctionLabelStyle}>
            {'\u2192'} {entry.correction}
          </span>
        )}

        {/* Relative time */}
        {!hovered && (
          <span style={timeStyle}>{relativeTime}</span>
        )}

        {/* Hover action buttons */}
        {hovered && entry.feedback == null && (
          <span style={actionButtonsStyle}>
            <button
              style={{ ...actionBtnStyle, color: '#2ECC71' }}
              onClick={(e) => { e.stopPropagation(); onConfirm(entry.id); }}
              title="Mark correct"
            >
              {'\u2713'}
            </button>
            <button
              style={{ ...actionBtnStyle, color: '#E74C3C' }}
              onClick={(e) => { e.stopPropagation(); onToggleExpand(entry.id); }}
              title="Mark incorrect"
            >
              {'\u2717'}
            </button>
          </span>
        )}
      </div>

      {/* Correction dropdown */}
      {isExpanded && (
        <div style={correctionDropdownStyle}>
          {CORRECTION_OPTIONS.map((option) => (
            <button
              key={option}
              style={correctionPillStyle}
              onClick={() => {
                onCorrect(entry.id, option);
                onToggleExpand(entry.id);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main Component ---

export const GestureFeedbackPanel = memo(function GestureFeedbackPanel({
  entries,
  onConfirm,
  onCorrect,
}: GestureFeedbackPanelProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tick relative times every second
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll to bottom on new entries
  const lastId = entries.length > 0 ? entries[entries.length - 1].id : null;
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lastId]);

  const visible = entries.slice(-15);

  const confirmed = entries.filter((e) => e.feedback === 'correct').length;
  const incorrect = entries.filter((e) => e.feedback === 'incorrect').length;
  const pending = entries.filter((e) => e.feedback == null).length;

  function handleToggleExpand(id: number) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>GESTURE LOG</div>

      {/* Scrollable gesture feed */}
      <div ref={scrollRef} style={feedStyle}>
        {visible.length === 0 ? (
          <div style={emptyStyle}>no gestures yet</div>
        ) : (
          visible.map((entry) => (
            <GestureRow
              key={entry.id}
              entry={entry}
              expandedId={expandedId}
              onConfirm={onConfirm}
              onCorrect={onCorrect}
              onToggleExpand={handleToggleExpand}
              now={now}
            />
          ))
        )}
      </div>

      {/* Footer summary */}
      <div style={footerStyle}>
        <span style={{ color: '#2ECC71' }}>{confirmed} {'\u2713'}</span>
        <span style={footerSepStyle} />
        <span style={{ color: '#E74C3C' }}>{incorrect} {'\u2717'}</span>
        <span style={footerSepStyle} />
        <span style={{ color: '#888' }}>{pending} {'\u2014'}</span>
      </div>
    </div>
  );
});

// --- Styles ---

const containerStyle: React.CSSProperties = {
  width: 220,
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 11,
  color: '#ccc',
  background: 'rgba(0,0,0,0.85)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  padding: 10,
};

const headerStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: 'rgba(255,255,255,0.45)',
  marginBottom: 6,
  textTransform: 'uppercase',
};

const feedStyle: React.CSSProperties = {
  maxHeight: 200,
  overflowY: 'auto',
  borderTop: '1px solid rgba(255,255,255,0.08)',
  paddingTop: 4,
};

const emptyStyle: React.CSSProperties = {
  opacity: 0.3,
  fontSize: 9,
  textAlign: 'center',
  padding: '6px 0',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '2px 0 2px 4px',
  lineHeight: 1.45,
  cursor: 'default',
  minHeight: 20,
};

const dotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  flexShrink: 0,
  display: 'inline-block',
};

const timeStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.3)',
  fontSize: 9,
  flexShrink: 0,
};

const actionButtonsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  flexShrink: 0,
};

const actionBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '0 2px',
  lineHeight: 1,
};

const correctionLabelStyle: React.CSSProperties = {
  color: '#F39C12',
  fontSize: 9,
  flexShrink: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 70,
};

const correctionDropdownStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 3,
  padding: '4px 6px 5px',
  background: 'rgba(255,255,255,0.04)',
  borderTop: '1px solid rgba(255,255,255,0.06)',
};

const correctionPillStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 3,
  color: '#ccc',
  cursor: 'pointer',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 9,
  padding: '1px 5px',
  lineHeight: 1.5,
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  borderTop: '1px solid rgba(255,255,255,0.08)',
  marginTop: 6,
  paddingTop: 5,
  fontSize: 10,
};

const footerSepStyle: React.CSSProperties = {
  width: 1,
  height: 10,
  background: 'rgba(255,255,255,0.12)',
  flexShrink: 0,
};
