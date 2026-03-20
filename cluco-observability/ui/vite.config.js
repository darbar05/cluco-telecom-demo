import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendUrl = process.env.VITE_BACKEND_URL || 'http://localhost:9410'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    entries: [],
    include: [
      'react', 'react-dom', 'react-router-dom', 'axios',
      'recharts', 'lucide-react', 'reactflow', 'dagre',
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 9411,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/ws': {
        target: backendUrl.replace('http', 'ws'),
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
