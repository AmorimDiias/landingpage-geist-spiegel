import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {}, // Necessário para React
  },
  build: {
    emptyOutDir: false,
    outDir: 'dist/content',
    lib: {
      entry: resolve(__dirname, 'src/content/index.tsx'),
      name: 'ContentScript',
      fileName: () => 'index.js',
      formats: ['iife'], // IIFE isola o escopo
    },
    rollupOptions: {
      output: {
        extend: true,
        inlineDynamicImports: true,
        entryFileNames: 'index.js',
        assetFileNames: 'style.css', // Força nome fixo para o CSS

        // --- CORREÇÃO DO ERRO 'define' ---
        // Injeta código no topo para esconder o AMD do YouTube
        banner: `
          var define = undefined; 
          var require = undefined;
        `,
        // ---------------------------------

        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
    target: 'esnext',
    minify: false,
  },
});
