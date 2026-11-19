import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: { outDir: '../../out/renderer', emptyOutDir: true, chunkSizeWarningLimit: 3000 },
  test: undefined as never,
});
