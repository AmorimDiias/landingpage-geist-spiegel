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
      entry: resolve(__dirname, 'src/content/imagefx.ts'),
      name: 'ImageFXScript',
      fileName: () => 'imagefx.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        extend: true,
        inlineDynamicImports: true,
        entryFileNames: 'imagefx.js',
        banner: `
          var define = undefined; 
          var require = undefined;
        `,
      },
    },
    target: 'esnext',
    minify: false,
  },
});
