import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

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
