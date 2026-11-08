import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { securityHeaders } from './security.config.js'

export default defineConfig({
  plugins: [react(), securityHeaders()],
  // Pre-bundle the UMD Leaflet libraries so leaflet-draw can find the global L
  optimizeDeps: {
    include: ['leaflet', 'leaflet-draw', '@maplibre/maplibre-gl-leaflet'],
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  // MapLibre (~1 MB) is its own lazily loaded chunk, fetched only when the Street basemap is chosen
  build: { chunkSizeWarningLimit: 1100 },
  // MapLibre's worker uses ES modules (import.meta), so bundle workers as ES modules
  worker: { format: 'es' },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
  },
})
