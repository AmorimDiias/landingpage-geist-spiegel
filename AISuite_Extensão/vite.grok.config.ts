
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  define: {
    'process.env': {},
  },
  build: {
    emptyOutDir: false,
    outDir: 'dist/content',
    lib: {
      entry: resolve(__dirname, 'src/content/grok.ts'),
      name: 'GrokScript',
      fileName: () => 'grok.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        extend: true,
        inlineDynamicImports: true,
        entryFileNames: 'grok.js',
      },
    },
    target: 'esnext',
    minify: false,
  },
});
