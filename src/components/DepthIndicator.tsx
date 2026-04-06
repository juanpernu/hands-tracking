import { memo, useEffect, useState, useRef } from 'react';

interface DepthIndicatorProps {
  depthRef: React.MutableRefObject<{
    left: { handSize: number; zone: string; calibratedMean: number; confidence: number } | null;
    right: { handSize: number; zone: string; calibratedMean: number; confidence: number } | null;
  }>;
  visible: boolean;
}

interface DepthSnapshot {
  zone: string;
  confidence: number;
}

function getDisplayProps(snapshot: DepthSnapshot | null): {
  text: string;
  color: string;
  pulsing: boolean;
} {
  if (snapshot === null) {
    return { text: 'No hand detected', color: 'rgba(255,255,255,0.4)', pulsing: false };
  }

  const { zone, confidence } = snapshot;

  if (zone === 'calibrating') {
    return {
      text: `Calibrating... ${Math.round(confidence * 100)}%`,
      color: '#fff',
      pulsing: true,
    };
  }

  if (zone === 'too-far') {
    return { text: '↑ Move closer', color: '#FF6B6B', pulsing: false };
  }

  if (zone === 'too-close') {
    return { text: '↓ Move back', color: '#FF6B6B', pulsing: false };
  }

  // optimal
  return { text: '✓ Good distance', color: '#2ECC71', pulsing: false };
}

export const DepthIndicator = memo(function DepthIndicator({ depthRef, visible }: DepthIndicatorProps) {
  const [snapshot, setSnapshot] = useState<DepthSnapshot | null>(null);
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);
  const optimalSinceRef = useRef<number | null>(null);
  const hiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll depthRef every 200ms
  useEffect(() => {
    const id = setInterval(() => {
      const { left, right } = depthRef.current;
      const hand = right ?? left;

      if (hand === null) {
        setSnapshot(null);
        optimalSinceRef.current = null;
        hiddenRef.current = false;
        setHidden(false);
        if (hiddenTimerRef.current !== null) {
          clearTimeout(hiddenTimerRef.current);
          hiddenTimerRef.current = null;
        }
        return;
      }

      setSnapshot({ zone: hand.zone, confidence: hand.confidence });

      if (hand.zone === 'optimal') {
        if (optimalSinceRef.current === null) {
          optimalSinceRef.current = Date.now();
          hiddenRef.current = false;
          setHidden(false);
        } else if (Date.now() - optimalSinceRef.current >= 2000 && !hiddenRef.current) {
          hiddenRef.current = true;
          setHidden(true);
        }
      } else {
        optimalSinceRef.current = null;
        hiddenRef.current = false;
        setHidden(false);
        if (hiddenTimerRef.current !== null) {
          clearTimeout(hiddenTimerRef.current);
          hiddenTimerRef.current = null;
        }
      }
    }, 200);

    return () => {
      clearInterval(id);
      if (hiddenTimerRef.current !== null) {
        clearTimeout(hiddenTimerRef.current);
      }
    };
  }, [depthRef]);

  if (!visible || hidden) {
    return null;
  }

  const { text, color, pulsing } = getDisplayProps(snapshot);

  return (
    <div style={containerStyle}>
      <span
        style={{
          color,
          animation: pulsing ? 'depth-pulse 1s ease-in-out infinite' : 'none',
          transition: pulsing ? undefined : 'color 0.2s ease',
        }}
      >
        {text}
      </span>
    </div>
  );
});

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 1000,
  background: 'rgba(0,0,0,0.75)',
  borderRadius: 20,
  padding: '4px 16px',
  fontFamily: 'monospace',
  fontSize: 11,
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
};
