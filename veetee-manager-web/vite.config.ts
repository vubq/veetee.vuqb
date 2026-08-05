import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const allowedHosts = (process.env.VEETEE_WEB_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Vite rejects an HTTPS Host header that is not explicitly allowed. Keep
    // this list deployment-configured so a hostname change never requires a
    // source edit, while preserving Vite's safe defaults when unset.
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
    proxy: {
      ...(process.env.VEETEE_WEB_API_PROXY_TARGET
        ? {
            '/api': {
              target: process.env.VEETEE_WEB_API_PROXY_TARGET,
              changeOrigin: false,
            },
            '/openapi.json': {
              target: process.env.VEETEE_WEB_API_PROXY_TARGET,
              changeOrigin: false,
            },
          }
        : {}),
      ...(process.env.VEETEE_WEB_VOICE_PROXY_TARGET
        ? {
            '/veetee': {
              target: process.env.VEETEE_WEB_VOICE_PROXY_TARGET,
              changeOrigin: false,
              ws: true,
            },
          }
        : {}),
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
})
