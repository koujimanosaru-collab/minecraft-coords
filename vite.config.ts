import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'マイクラ座標メモ',
        short_name: '座標メモ',
        lang: 'ja',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1f2a1d',
        theme_color: '#3f7d34',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        // 読み取り用の大きなファイルは初回インストールに含めず、初めて使ったときにキャッシュする
        globIgnores: ['tesseract/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/tesseract/'),
            handler: 'CacheFirst',
            options: { cacheName: 'tesseract', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
