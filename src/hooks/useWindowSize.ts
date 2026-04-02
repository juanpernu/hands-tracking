import { useState, useEffect, useRef } from 'react';

const DEBOUNCE_MS = 150;

export function useWindowSize() {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onResize = () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setSize({ width: window.innerWidth, height: window.innerHeight });
      }, DEBOUNCE_MS);
    };

    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return size;
}
