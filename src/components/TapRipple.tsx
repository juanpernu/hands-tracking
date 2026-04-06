import { useState, useCallback, useImperativeHandle, forwardRef, useRef } from 'react';

export interface TapRippleHandle {
  trigger: (x: number, y: number) => void;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

const TapRipple = forwardRef<TapRippleHandle>((_, ref) => {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const idRef = useRef(0);

  const trigger = useCallback((x: number, y: number) => {
    const id = ++idRef.current;
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 300);
  }, []);

  useImperativeHandle(ref, () => ({ trigger }), [trigger]);

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1100 }}>
      {ripples.map((r) => (
        <div
          key={r.id}
          style={{
            position: 'absolute',
            left: r.x - 20,
            top: r.y - 20,
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '2px solid #4ECDC4',
            background: 'rgba(255, 255, 255, 0.3)',
            pointerEvents: 'none',
            animation: 'tap-ripple 300ms ease-out forwards',
          }}
        />
      ))}
    </div>
  );
});

TapRipple.displayName = 'TapRipple';
export default TapRipple;
