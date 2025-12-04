import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Base path for Vercel deployment (root domain)
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
