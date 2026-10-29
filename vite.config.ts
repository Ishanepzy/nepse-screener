import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works at any URL prefix (e.g. https://<user>.github.io/nepse-screener/).
  base: './',
  server: { port: 5173 },
});
