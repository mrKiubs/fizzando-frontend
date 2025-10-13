// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    minify: 'esbuild', // veloce e ottimo
    rollupOptions: {
      output: {
        // Accorpiamo dipendenze frequenti in pochi chunk "stabili"
        manualChunks: {
          angular: [
            '@angular/core',
            '@angular/common',
            '@angular/platform-browser',
            '@angular/router',
          ],
          rxutils: ['rxjs', 'rxjs/operators'],
          // Se usi Angular Material o altre UI lib, puoi aggiungerle qui:
          // ui: ['@angular/material']
        },
      },
    },
  },
});
