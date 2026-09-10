import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 7 shell of the technician app (ARCHITECTURE section 4 "Capacitor later"). The web
 * assets come from `npm run build:native` (base "/", VITE_NATIVE=1, dist-native/); the PWA build
 * in dist/ stays the one the API serves at /tech/. The app talks to the server over https with
 * the bearer token (no cookies), so the WebView origin `https://localhost` is what the API's CORS
 * allows. Cleartext http is off: a LAN dev server must be reached over https or through the
 * `server.url` override below (dev only, never committed enabled).
 */
const config: CapacitorConfig = {
  appId: 'bg.avroleva.elevators.tech',
  appName: 'Avroleva Elevators',
  webDir: 'dist-native',
  server: {
    androidScheme: 'https',
    cleartext: false,
    // url: 'http://192.168.0.10:5176', // live-reload against the Vite dev server (dev only)
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#ffffff',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: '#1d5fd1',
      androidScaleType: 'CENTER_CROP',
      splashImmersive: false,
      splashFullScreen: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#1d5fd1',
      overlaysWebView: false,
    },
  },
}

export default config
