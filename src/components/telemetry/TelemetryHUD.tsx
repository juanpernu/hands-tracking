import React from 'react';

interface TelemetryHUDProps {
  handCount: number;
  velocity: number;
  acceleration: number;
  gripState: { type: string; confidence: number } | null;
  currentGesture: string;
  motionPattern: string;
  fps: number;
}

function fpsColor(fps: number): string {
  if (fps < 30) return '#FF5F56';
  if (fps < 50) return '#FFBD2E';
  return '#27C93F';
}

function gripColor(confidence: number): string {
  if (confidence < 0.3) return '#27C93F';
  if (confidence < 0.7) return '#FFBD2E';
  return '#FF5F56';
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  padding: '2px 0',
};

const labelStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.45)',
  letterSpacing: '0.06em',
};

const valueStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.85)',
};

export function TelemetryHUD({
  handCount,
  velocity,
  acceleration,
  gripState,
  currentGesture,
  motionPattern,
  fps,
}: TelemetryHUDProps) {
  const accelSign = acceleration >= 0 ? '+' : '';

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 1150,
        width: 220,
        background: 'rgba(0,0,0,0.72)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 6,
        padding: '8px 10px',
        fontFamily: 'monospace',
        fontSize: 11,
        color: 'rgba(255,255,255,0.85)',
        pointerEvents: 'none',
      }}
    >
      <div style={rowStyle}>
        <span style={labelStyle}>HANDS</span>
        <span style={valueStyle}>{handCount}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>VELOCITY</span>
        <span style={valueStyle}>{velocity.toFixed(1)} px/f</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>ACCEL</span>
        <span style={valueStyle}>
          {accelSign}{acceleration.toFixed(1)} px/f²
        </span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>GRIP</span>
        {gripState ? (
          <span
            style={{
              ...valueStyle,
              color: gripColor(gripState.confidence),
            }}
          >
            {gripState.type} {Math.round(gripState.confidence * 100)}%
          </span>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>—</span>
        )}
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>GESTURE</span>
        <span style={valueStyle}>{currentGesture || '—'}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>MOTION</span>
        <span style={valueStyle}>{motionPattern || '—'}</span>
      </div>

      <div
        style={{
          ...rowStyle,
          borderTop: '1px solid rgba(255,255,255,0.07)',
          marginTop: 4,
          paddingTop: 4,
        }}
      >
        <span style={labelStyle}>FPS</span>
        <span style={{ ...valueStyle, color: fpsColor(fps) }}>
          {Math.round(fps)}
        </span>
      </div>
    </div>
  );
}

export default TelemetryHUD;
