import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['crate-icon.svg'],
      manifest: {
        name: 'Crate',
        short_name: 'Crate',
        theme_color: '#FF6A00',
        background_color: '#111111',
        display: 'standalone',
        icons: [
          { src: '/crate-icon.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/crate-icon.svg', sizes: '512x512', type: 'image/svg+xml' }
        ]
      }
    })
  ]
});
