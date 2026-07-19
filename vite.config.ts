import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  plugins: [react()],
  resolve: {
    alias: {
      '@web': fileURLToPath(new URL('./web/src', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/health': 'http://127.0.0.1:4000',
      '/metrics': 'http://127.0.0.1:4000',
    },
  },
})
