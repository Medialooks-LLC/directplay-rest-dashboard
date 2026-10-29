import { defineConfig } from 'vite';

const directPlayTarget = process.env.DIRECTPLAY_REST_TARGET || 'http://127.0.0.1:9532';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 9002,
    proxy: {
      '/dp-api': {
        target: directPlayTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dp-api/, '/api')
      }
    }
  }
});
