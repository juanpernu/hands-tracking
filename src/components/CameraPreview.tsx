import React, { useState } from 'react';
import { PANEL } from '../config';

interface CameraPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  visible: boolean;
}

export default function CameraPreview({ videoRef, visible }: CameraPreviewProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!visible) return null;

  return (
    <div
      style={{
        width: PANEL.CAMERA_WIDTH,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.3)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        userSelect: 'none',
      }}
    >
      {/* Title bar */}
      <div
        style={{
          height: PANEL.TITLE_BAR_HEIGHT,
          background: 'linear-gradient(180deg, #3a3a3a 0%, #2e2e2e 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          borderBottom: '1px solid rgba(0, 0, 0, 0.4)',
        }}
      >
        {/* macOS-style traffic lights (decorative) */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF5F56' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#FFBD2E' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#27C93F' }} />
        </div>

        {/* Persistent camera-active indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#FF3232',
              boxShadow: '0 0 4px rgba(255, 50, 50, 0.6)',
            }}
          />
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: '#fff',
              letterSpacing: '0.05em',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            }}
          >
            LIVE
          </span>
        </div>

        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.75)',
            letterSpacing: '0.02em',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}
        >
          Camera
        </span>

        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 4,
            color: 'rgba(255, 255, 255, 0.7)',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            lineHeight: 1,
            padding: '2px 6px',
          }}
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {/* Video area */}
      {!collapsed && (
        <div
          style={{
            width: PANEL.CAMERA_WIDTH,
            height: PANEL.CAMERA_HEIGHT,
            background: '#111',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              // Mirror horizontally so the feed feels natural
              transform: 'scaleX(-1)',
            }}
          />
        </div>
      )}
    </div>
  );
}
