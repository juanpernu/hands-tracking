import { useState, useRef, useCallback, useEffect, memo, forwardRef, useImperativeHandle } from 'react';

// ============================================================
// Types
// ============================================================

export interface NavigationBarHandle {
  show: () => void;
  hide: () => void;
  isVisible: boolean;
}

// ============================================================
// localStorage helpers
// ============================================================

const STORAGE_KEY = 'hands-tracker-recent-urls';
const MAX_RECENT = 10;

function getRecentUrls(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveRecentUrl(url: string): void {
  const recents = getRecentUrls().filter(u => u !== url);
  recents.unshift(url);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recents.slice(0, MAX_RECENT)));
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// ============================================================
// Component
// ============================================================

const NavigationBar = memo(
  forwardRef<NavigationBarHandle>(function NavigationBar(_props, ref) {
    const [visible, setVisible] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [recentUrls, setRecentUrls] = useState<string[]>([]);

    const inputRef = useRef<HTMLInputElement>(null);

    // Expose handle to parent
    useImperativeHandle(
      ref,
      () => ({
        show() {
          setVisible(true);
        },
        hide() {
          setVisible(false);
        },
        get isVisible() {
          return visible;
        },
      }),
      [visible],
    );

    // Reload recents when bar opens
    useEffect(() => {
      if (visible) {
        setRecentUrls(getRecentUrls());
        // Auto-focus input on next tick so the element is mounted
        setTimeout(() => {
          inputRef.current?.focus();
        }, 0);
      }
    }, [visible]);

    const navigate = useCallback((rawUrl: string) => {
      const url = normalizeUrl(rawUrl);
      if (!url) return;
      saveRecentUrl(url);
      setRecentUrls(getRecentUrls());
      setIframeUrl(`/api/proxy?url=${encodeURIComponent(url)}`);
      setIsLoading(true);
      setVisible(false);
      setInputValue('');
    }, []);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          navigate(inputValue);
        } else if (e.key === 'Escape') {
          setVisible(false);
          setInputValue('');
        }
      },
      [inputValue, navigate],
    );

    const handleCloseIframe = useCallback(() => {
      setIframeUrl(null);
      setIsLoading(false);
    }, []);

    const filteredRecents = recentUrls
      .filter(u => !inputValue || u.toLowerCase().includes(inputValue.toLowerCase()))
      .slice(0, 5);

    return (
      <>
        {/* URL input bar */}
        {visible && (
          <div style={barContainerStyle}>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter URL..."
              style={inputStyle}
              spellCheck={false}
              autoComplete="off"
            />

            {/* Autocomplete dropdown */}
            {filteredRecents.length > 0 && (
              <div style={dropdownStyle}>
                {filteredRecents.map(url => (
                  <button
                    key={url}
                    style={dropdownItemStyle}
                    onClick={() => navigate(url)}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        'rgba(255,255,255,0.08)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }}
                  >
                    <span style={dropdownDotStyle} />
                    <span style={dropdownUrlStyle}>{url}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Iframe */}
        {iframeUrl !== null && (
          <iframe
            src={iframeUrl}
            style={iframeStyle}
            title="NavigationBar iframe"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            onLoad={() => setIsLoading(false)}
          />
        )}

        {/* Loading indicator */}
        {iframeUrl !== null && isLoading && (
          <div style={loadingBarStyle}>
            <div style={loadingFillStyle} />
          </div>
        )}

        {/* Close button */}
        {iframeUrl !== null && (
          <button style={closeButtonStyle} onClick={handleCloseIframe} title="Close">
            ✕
          </button>
        )}
      </>
    );
  }),
);

NavigationBar.displayName = 'NavigationBar';

export { NavigationBar };

// ============================================================
// Styles
// ============================================================

const barContainerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 500,
  zIndex: 2000,
  background: 'rgba(0,0,0,0.9)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '0 0 12px 12px',
  padding: '12px 16px',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  padding: '8px 12px',
  color: '#fff',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 13,
  outline: 'none',
};

const dropdownStyle: React.CSSProperties = {
  marginTop: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};

const dropdownItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderRadius: 4,
  padding: '5px 6px',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background 0.1s',
};

const dropdownDotStyle: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.3)',
  flexShrink: 0,
};

const dropdownUrlStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.65)',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const iframeStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  width: '100vw',
  height: '100vh',
  zIndex: -1,
  border: 'none',
};

const loadingBarStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  height: 2,
  zIndex: 1999,
  background: 'rgba(255,255,255,0.08)',
};

const loadingFillStyle: React.CSSProperties = {
  height: '100%',
  width: '40%',
  background: 'rgba(78,205,196,0.8)',
  animation: 'navbarLoadingSlide 1.2s ease-in-out infinite',
};

// Inject keyframes once
if (typeof document !== 'undefined') {
  const styleId = 'navbar-loading-keyframes';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes navbarLoadingSlide {
        0%   { margin-left: -40%; }
        100% { margin-left: 100%; }
      }
    `;
    document.head.appendChild(style);
  }
}

const closeButtonStyle: React.CSSProperties = {
  position: 'fixed',
  top: 8,
  right: 8,
  zIndex: 2001,
  background: 'rgba(0,0,0,0.7)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '50%',
  width: 28,
  height: 28,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  lineHeight: 1,
  padding: 0,
};
