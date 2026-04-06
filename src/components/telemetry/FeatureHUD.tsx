import { memo } from 'react';
import type { HandFeatureVector, JointAngles, GesturePhase } from '../../types/features';
import { PANEL } from '../../config';

interface FeatureHUDProps {
  featuresData: HandFeatureVector[];
}

const FINGER_LABELS = ['T', 'I', 'M', 'R', 'P'] as const;
const JOINT_LABELS = ['MCP', 'PIP', 'DIP'] as const;
const FINGER_KEYS: (keyof JointAngles)[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

const PHASE_COLORS: Record<GesturePhase, string> = {
  idle: '#666',
  preparation: '#FFBD2E',
  stroke: '#27C93F',
  retraction: '#FF8C00',
};

function angleColor(rad: number): string {
  if (rad < 0.5) return '#27C93F';
  if (rad < 1.2) return '#FFBD2E';
  return '#FF5F56';
}

function radToDeg(rad: number): number {
  return Math.round(rad * (180 / Math.PI));
}

function HandFeaturePanel({ feature, label }: { feature: HandFeatureVector | undefined; label: string }) {
  if (!feature) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>{label}</div>
        <div style={{ ...rowStyle, opacity: 0.4 }}>Not detected</div>
      </div>
    );
  }

  const { jointAngles, palmOrientation, gesturePhase, handOpenness, fingerCurlRatios } = feature;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>{label}</div>

      {/* Joint angles: 5 fingers x 3 joints */}
      <div style={sectionHeader}>JOINT ANGLES</div>
      <div style={jointGridStyle}>
        {/* Column headers */}
        <div style={jointLabelCell} />
        {JOINT_LABELS.map((j) => (
          <div key={j} style={jointLabelCell}>{j}</div>
        ))}
        {/* Rows per finger */}
        {FINGER_KEYS.map((fKey, fi) => {
          const angles = jointAngles[fKey];
          return (
            <div key={fKey} style={{ display: 'contents' }}>
              <div style={fingerLabelCell}>{FINGER_LABELS[fi]}</div>
              {(['mcp', 'pip', 'dip'] as const).map((jKey) => {
                const raw = angles?.[jKey];
                const val = (typeof raw === 'number' && isFinite(raw)) ? raw : 0;
                const pct = Math.min(val / Math.PI, 1);
                return (
                  <div key={jKey} style={barCell}>
                    <div style={{
                      ...barFill,
                      width: `${pct * 100}%`,
                      backgroundColor: angleColor(val),
                    }} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Palm orientation */}
      <div style={sectionHeader}>PALM ORIENTATION</div>
      <div style={rowStyle}>
        <span style={{ opacity: 0.6 }}>P: {radToDeg(palmOrientation.pitch)}{'\u00B0'}</span>
        <span style={{ opacity: 0.6 }}>Y: {radToDeg(palmOrientation.yaw)}{'\u00B0'}</span>
        <span style={{ opacity: 0.6 }}>R: {radToDeg(palmOrientation.roll)}{'\u00B0'}</span>
      </div>

      {/* Gesture phase */}
      <div style={{ ...rowStyle, marginTop: 4 }}>
        <span style={{ opacity: 0.6 }}>PHASE</span>
        <span style={{
          backgroundColor: PHASE_COLORS[gesturePhase] ?? '#666',
          color: '#fff',
          padding: '1px 6px',
          borderRadius: 3,
          fontSize: 9,
          fontWeight: 700,
        }}>
          {gesturePhase.toUpperCase()}
        </span>
      </div>

      {/* Hand openness */}
      <div style={{ ...rowStyle, marginTop: 4 }}>
        <span style={{ opacity: 0.6 }}>OPENNESS</span>
        <span>{Math.round(Math.min(handOpenness, 1) * 100)}%</span>
      </div>
      <div style={opennessBarContainer}>
        <div style={{
          ...opennessBarFill,
          width: `${Math.min(handOpenness, 1) * 100}%`,
        }} />
      </div>

      {/* Finger curl ratios */}
      <div style={sectionHeader}>FINGER CURL</div>
      <div style={curlBarContainer}>
        {FINGER_LABELS.map((finger, i) => {
          const curl = (typeof fingerCurlRatios[i] === 'number' && isFinite(fingerCurlRatios[i]))
            ? Math.max(0, Math.min(1, fingerCurlRatios[i]))
            : 0;
          return (
          <div key={finger} style={{ textAlign: 'center' }}>
            <div style={{
              ...curlBar,
              height: `${curl * 24}px`,
              backgroundColor: curl > 0.7 ? '#FF5F56' : curl > 0.4 ? '#FFBD2E' : '#27C93F',
            }} />
            <div style={{ fontSize: 8, opacity: 0.5 }}>{finger}</div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

function FeatureHUDInner({ featuresData }: FeatureHUDProps) {
  const left = featuresData.find((f) => f.handedness === 'Left');
  const right = featuresData.find((f) => f.handedness === 'Right');

  return (
    <div style={containerStyle}>
      <HandFeaturePanel feature={right} label="RIGHT FEATURES" />
      <HandFeaturePanel feature={left} label="LEFT FEATURES" />
    </div>
  );
}

export const FeatureHUD = memo(FeatureHUDInner);

// --- Styles ---

const containerStyle: React.CSSProperties = {
  width: PANEL.HUD_WIDTH + 80,
  maxWidth: 280,
  background: 'rgba(0,0,0,0.85)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '8px 10px',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 10,
  lineHeight: 1.6,
  color: 'rgba(255,255,255,0.85)',
  maxHeight: PANEL.HUD_MAX_HEIGHT,
  overflowY: 'auto',
};

const panelStyle: React.CSSProperties = {
  borderTop: '1px solid rgba(255,255,255,0.08)',
  paddingTop: 4,
  marginTop: 4,
};

const headerStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.05em',
  color: 'rgba(255,255,255,0.5)',
  marginBottom: 2,
};

const sectionHeader: React.CSSProperties = {
  fontSize: 8,
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: 'rgba(255,255,255,0.35)',
  marginTop: 4,
  marginBottom: 2,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const jointGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '16px 1fr 1fr 1fr',
  gap: '2px 3px',
  marginBottom: 4,
};

const jointLabelCell: React.CSSProperties = {
  fontSize: 7,
  opacity: 0.4,
  textAlign: 'center',
};

const fingerLabelCell: React.CSSProperties = {
  fontSize: 8,
  opacity: 0.5,
  textAlign: 'center',
  lineHeight: '10px',
};

const barCell: React.CSSProperties = {
  height: 8,
  background: 'rgba(255,255,255,0.08)',
  borderRadius: 2,
  overflow: 'hidden',
};

const barFill: React.CSSProperties = {
  height: '100%',
  borderRadius: 2,
  transition: 'width 100ms ease-out',
  minWidth: 1,
};

const opennessBarContainer: React.CSSProperties = {
  height: 6,
  background: 'rgba(255,255,255,0.08)',
  borderRadius: 3,
  overflow: 'hidden',
  marginTop: 2,
};

const opennessBarFill: React.CSSProperties = {
  height: '100%',
  background: '#4A90D9',
  borderRadius: 3,
  transition: 'width 100ms ease-out',
};

const curlBarContainer: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  justifyContent: 'center',
  margin: '4px 0 2px',
};

const curlBar: React.CSSProperties = {
  width: 16,
  minHeight: 2,
  borderRadius: 2,
  transition: 'height 100ms ease-out',
};
