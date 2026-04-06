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
  const optimalSinceRef = useRef<number | null>(null);
  const hiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pulseOpacity, setPulseOpacity] = useState(1);
  const pulseDirectionRef = useRef<1 | -1>(1);

  // Poll depthRef every 200ms
  useEffect(() => {
    const id = setInterval(() => {
      const { left, right } = depthRef.current;
      const hand = right ?? left;

      if (hand === null) {
        setSnapshot(null);
        optimalSinceRef.current = null;
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
          setHidden(false);
        } else if (Date.now() - optimalSinceRef.current >= 2000 && !hidden) {
          setHidden(true);
        }
      } else {
        optimalSinceRef.current = null;
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
  }, [depthRef, hidden]);

  // Pulse animation for calibrating state
  useEffect(() => {
    if (snapshot?.zone !== 'calibrating') {
      setPulseOpacity(1);
      return;
    }

    const id = setInterval(() => {
      setPulseOpacity(prev => {
        const next = prev + pulseDirectionRef.current * 0.08;
        if (next >= 1) {
          pulseDirectionRef.current = -1;
          return 1;
        }
        if (next <= 0.3) {
          pulseDirectionRef.current = 1;
          return 0.3;
        }
        return next;
      });
    }, 50);

    return () => clearInterval(id);
  }, [snapshot?.zone]);

  if (!visible || hidden) {
    return null;
  }

  const { text, color, pulsing } = getDisplayProps(snapshot);

  return (
    <div style={containerStyle}>
      <span
        style={{
          color,
          opacity: pulsing ? pulseOpacity : 1,
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
