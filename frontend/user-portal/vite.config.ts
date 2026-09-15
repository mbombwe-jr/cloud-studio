import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    // NOTE: no manualChunks — splitting Radix packages into a separate chunk
    // duplicates shared Radix internals (contexts) and crashes React at mount.
  },
})
