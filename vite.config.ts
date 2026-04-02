/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import telemetryPlugin from './vite-plugin-telemetry'

export default defineConfig({
  plugins: [react(), telemetryPlugin()],
  server: {
    // IMPORTANT: These COOP/COEP headers are required for SharedArrayBuffer
    // and cross-origin isolation used by MediaPipe WASM. In production, your
    // web server (nginx, Cloudflare, etc.) must also set these headers:
    //   Cross-Origin-Opener-Policy: same-origin
    //   Cross-Origin-Embedder-Policy: require-corp
    // Without them, the hand-tracking model will fail to load.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    globals: true,
  },
})
