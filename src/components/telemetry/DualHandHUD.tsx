import { magnitude3 } from '../../utils/geometry';
import { gripColor } from '../../utils/colors';
import type { HandPhysics, GripState, MotionPattern } from '../../types/telemetry';
import { TELEMETRY_VIS, PANEL } from '../../config';

interface DualHandHUDProps {
  physicsData: HandPhysics[];
  gripData: GripState[];
  motionData: MotionPattern[];
  fps: number;
}

function velocityColor(speed: number): string {
  if (speed < TELEMETRY_VIS.HUD_SPEED_THRESHOLDS[0]) return '#4A90D9';
  if (speed < TELEMETRY_VIS.HUD_SPEED_THRESHOLDS[1]) return '#27C93F';
  if (speed < TELEMETRY_VIS.HUD_SPEED_THRESHOLDS[2]) return '#FFBD2E';
  return '#FF5F56';
}

function HandPanel({ physics, grip, motion, label }: {
  physics: HandPhysics | undefined;
  grip: GripState | undefined;
  motion: MotionPattern | undefined;
  label: string;
}) {
  if (!physics) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>{label}</div>
        <div style={{ ...rowStyle, opacity: 0.4 }}>Not detected</div>
      </div>
    );
  }

  const speed = magnitude3(physics.palmVelocity) * TELEMETRY_VIS.HUD_PIXEL_MULTIPLIER; // to px/s
  const wristSpeed = magnitude3(physics.wristVelocity) * TELEMETRY_VIS.HUD_PIXEL_MULTIPLIER;
  const accel = physics.landmarks[0]
    ? magnitude3(physics.landmarks[0].acceleration) * TELEMETRY_VIS.HUD_PIXEL_MULTIPLIER
    : 0;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>{label}</div>

      <Row label="PALM V" value={`${speed.toFixed(1)}`} unit="px/s" color={velocityColor(speed)} />
      <Row label="WRIST V" value={`${wristSpeed.toFixed(1)}`} unit="px/s" color={velocityColor(wristSpeed)} />
      <Row label="ACCEL" value={`${accel >= 0 ? '+' : ''}${accel.toFixed(1)}`} unit="px/s²" />
      <Row label="AXIS" value={physics.dominantAxis} />
      <Row label="ANG VEL" value={`${(physics.angularVelocity * (180 / Math.PI)).toFixed(1)}`} unit="°/s" />

      {grip && (
        <>
          <Row
            label="GRIP"
            value={grip.gripType.toUpperCase()}
            color={gripColor(grip.gripForce)}
          />
          <Row label="FORCE" value={`${(grip.gripForce * TELEMETRY_VIS.HUD_GRIP_FORCE_MULTIPLIER).toFixed(0)}%`} color={gripColor(grip.gripForce)} />
          <div style={curlBarContainer}>
            {(['T', 'I', 'M', 'R', 'P'] as const).map((finger, i) => (
              <div key={finger} style={{ textAlign: 'center' }}>
                <div style={{
                  ...curlBar,
                  height: `${grip.fingerCurl[i] * TELEMETRY_VIS.HUD_CURL_BAR_HEIGHT}px`,
                  backgroundColor: grip.fingerCurl[i] > TELEMETRY_VIS.HUD_CURL_RED_THRESHOLD ? '#FF5F56' : grip.fingerCurl[i] > TELEMETRY_VIS.HUD_CURL_YELLOW_THRESHOLD ? '#FFBD2E' : '#27C93F',
                }} />
                <div style={{ fontSize: 8, opacity: 0.5 }}>{finger}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {motion && motion.type !== 'none' && (
        <Row
          label="MOTION"
          value={`${motion.type}${motion.swipeDirection ? ' ' + motion.swipeDirection : ''}`}
          color="#c084fc"
        />
      )}
    </div>
  );
}

function Row({ label, value, unit, color }: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
}) {
  return (
    <div style={rowStyle}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ color: color ?? 'rgba(255,255,255,0.85)' }}>
        {value}
        {unit && <span style={{ opacity: 0.4, fontSize: 9, marginLeft: 2 }}>{unit}</span>}
      </span>
    </div>
  );
}

export function DualHandHUD({ physicsData, gripData, motionData, fps }: DualHandHUDProps) {
  const leftPhysics = physicsData.find((p) => p.handedness === 'Left');
  const rightPhysics = physicsData.find((p) => p.handedness === 'Right');
  const leftGrip = gripData.find((g) => g.handedness === 'Left');
  const rightGrip = gripData.find((g) => g.handedness === 'Right');
  const leftMotionIdx = physicsData.findIndex((p) => p.handedness === 'Left');
  const rightMotionIdx = physicsData.findIndex((p) => p.handedness === 'Right');
  const leftMotion = leftMotionIdx >= 0 ? motionData[leftMotionIdx] : undefined;
  const rightMotion = rightMotionIdx >= 0 ? motionData[rightMotionIdx] : undefined;

  return (
    <div style={containerStyle}>
      <div style={{ ...rowStyle, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4, marginBottom: 4 }}>
        <span style={{ opacity: 0.6 }}>FPS</span>
        <span style={{ color: fps > TELEMETRY_VIS.FPS_GREEN_THRESHOLD ? '#27C93F' : fps > TELEMETRY_VIS.FPS_YELLOW_THRESHOLD ? '#FFBD2E' : '#FF5F56' }}>{fps}</span>
      </div>
      <div style={{ ...rowStyle, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4, marginBottom: 4 }}>
        <span style={{ opacity: 0.6 }}>HANDS</span>
        <span>{physicsData.length}</span>
      </div>
      <HandPanel physics={rightPhysics} grip={rightGrip} motion={rightMotion} label="RIGHT HAND" />
      <HandPanel physics={leftPhysics} grip={leftGrip} motion={leftMotion} label="LEFT HAND" />
    </div>
  );
}

// --- Styles ---

const containerStyle: React.CSSProperties = {
  width: PANEL.HUD_WIDTH,
  background: 'rgba(0,0,0,0.78)',
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

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
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
