import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Pre-bundle the UMD Leaflet libraries so leaflet-draw can find the global L
  optimizeDeps: {
    include: ['leaflet', 'leaflet-draw'],
  },
  server: { port: 5173 },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
  },
})
