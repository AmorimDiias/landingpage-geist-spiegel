import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  define: {
    'process.env': {},
    'window.global': 'self',
  },
  build: {
    target: 'esnext',
    emptyOutDir: false,
    outDir: 'dist',
    lib: {
      entry: resolve(__dirname, 'src/background/index.ts'),
      name: 'BackgroundScript',
      fileName: () => 'assets/background.js',
      formats: ['iife'],
    },
  },
});
