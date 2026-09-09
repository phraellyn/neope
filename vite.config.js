import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/compiler-api': {
        // En redes institucionales se bloquean las conexiones HTTP directas
        // a la IP del compilador. La Function HTTPS hace de proxy seguro.
        target: process.env.VITE_COMPILER_PROXY_TARGET
          || 'https://europe-west1-neope-9e229.cloudfunctions.net/compilerProxy',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/compiler-api/, ''),
      },
      '/firebase-storage': {
        target: 'https://firebasestorage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/firebase-storage/, ''),
      },
    },
  },
})
