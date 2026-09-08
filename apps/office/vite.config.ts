import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE is baked in at build time (ARCHITECTURE A11). Behind nginx the app lives under a
// prefix that nginx strips (VPS-GUIDE), so the browser must request /avroleva/… while the
// server sees /…; API calls are relative to that base.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3005', changeOrigin: true },
      '/print': { target: 'http://127.0.0.1:3005', changeOrigin: true },
      '/p': { target: 'http://127.0.0.1:3005', changeOrigin: true },
      '/files': { target: 'http://127.0.0.1:3005', changeOrigin: true },
      '/tech': { target: 'http://127.0.0.1:3005', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
})
