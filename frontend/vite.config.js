import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development, /api requests are forwarded to the backend, so there are no CORS problems.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Orders module (Python). Same login token: the frontend sends Authorization: Bearer <token> to /orders-api/...
      '/orders-api': { target: 'http://localhost:8000', rewrite: (path) => path.replace(/^\/orders-api/, '/api/v1') },
      '/api': 'http://localhost:3000',
    },
  },
});
