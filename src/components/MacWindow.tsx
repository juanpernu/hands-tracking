import React from 'react';

interface MacWindowProps {
  children: React.ReactNode;
}

const TITLE_BAR_HEIGHT = 40;

const styles = {
  window: {
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    overflow: 'hidden',
    display: 'inline-flex',
    flexDirection: 'column' as const,
  },
  titleBar: {
    height: TITLE_BAR_HEIGHT,
    background: 'linear-gradient(to bottom, #e8e8e8, #d0d0d0)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative' as const,
    flexShrink: 0,
    userSelect: 'none' as const,
  },
  trafficLights: {
    position: 'absolute' as const,
    left: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  trafficLight: (color: string) => ({
    width: 12,
    height: 12,
    borderRadius: '50%',
    backgroundColor: color,
  }),
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: '#3a3a3a',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    letterSpacing: '-0.01em',
  },
  content: {
    flex: 1,
    display: 'flex',
  },
} as const;

export function MacWindow({ children }: MacWindowProps) {
  return (
    <div style={styles.window}>
      <div style={styles.titleBar}>
        <div style={styles.trafficLights}>
          <div style={styles.trafficLight('#FF5F57')} />
          <div style={styles.trafficLight('#FFBD2E')} />
          <div style={styles.trafficLight('#28CA42')} />
        </div>
        <span style={styles.title}>Hands Tracker</span>
      </div>
      <div style={styles.content}>{children}</div>
    </div>
  );
}
