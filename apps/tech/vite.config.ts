import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// VITE_TECH_BASE is BASE_PATH + "/tech/" (the API serves the built app at /tech/). The API base
// is derived from it at runtime unless VITE_API_BASE (origin, or origin + BASE_PATH) is given.
const base = process.env.VITE_TECH_BASE || '/tech/'
const proxyTarget = 'http://127.0.0.1:3005'

export default defineConfig({
  base,
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.VITE_APP_VERSION || pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'Avroleva Монтьор',
        short_name: 'Avroleva',
        description: 'Avroleva - приложение за монтьори',
        lang: 'bg',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1d5fd1',
        background_color: '#ffffff',
        scope: base,
        start_url: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5176,
    strictPort: true,
    proxy: {
      '/api': { target: proxyTarget, changeOrigin: true },
      '/files': { target: proxyTarget, changeOrigin: true },
      '/print': { target: proxyTarget, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2020' },
})
