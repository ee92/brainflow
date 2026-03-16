import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3900',
      '/healthz': 'http://localhost:3900',
      '/readyz': 'http://localhost:3900',
    },
  },
});
