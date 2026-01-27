import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Base URL para GitHub Pages
  base: '/PruebaMapJapan/',
  
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        tokyo: resolve(__dirname, 'tokyo.html'),
        nagoya: resolve(__dirname, 'nagoya.html'),
        takayama: resolve(__dirname, 'takayama.html'),
        kyoto: resolve(__dirname, 'kyoto.html'),
        osaka: resolve(__dirname, 'osaka.html'),
        naoshima: resolve(__dirname, 'naoshima.html'),
        hakone: resolve(__dirname, 'hakone.html'),
        tokyo2: resolve(__dirname, 'tokyo2.html'),
      },
      output: {
        manualChunks: {
          leaflet: ['leaflet'],
        },
      },
    },
  },
  
  server: {
    port: 3000,
    open: true,
  },
});
