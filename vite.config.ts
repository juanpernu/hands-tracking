import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import telemetryPlugin from './vite-plugin-telemetry'

export default defineConfig({
  plugins: [react(), telemetryPlugin()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
