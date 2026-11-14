import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000, // Rapier's WASM is embedded in its JS module
  },
});
