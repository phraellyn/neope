import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/compiler-api': {
        target: 'http://51.170.57.25:5000',
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
