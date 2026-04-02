const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);

export function validateUrl(raw: string): { valid: true; url: string } | { valid: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw, window.location.origin);
  } catch {
    return { valid: false, reason: 'Invalid URL' };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { valid: false, reason: `Blocked protocol: ${parsed.protocol}` };
  }
  return { valid: true, url: parsed.href };
}
