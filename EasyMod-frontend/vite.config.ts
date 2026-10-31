import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          const nodeModulesMarker = '/node_modules/';
          const nodeModulesIndex = normalizedId.lastIndexOf(nodeModulesMarker);
          if (nodeModulesIndex < 0) return undefined;

          const packagePath = normalizedId.slice(nodeModulesIndex + nodeModulesMarker.length);
          const packageName = packagePath.startsWith('@')
            ? packagePath.split('/').slice(0, 2).join('/')
            : packagePath.split('/')[0];

          // Keep only the React runtime in this shared chunk. Grouping every
          // dependency with "react" in its package name forced signup forms,
          // Sentry, and app-only libraries onto the public landing's critical path.
          if (['react', 'react-dom', 'scheduler', 'react-is', 'loose-envify'].includes(packageName)) return 'react-vendor';
          if (packageName === 'react-router' || packageName === 'react-router-dom') return 'router-vendor';
          if (packageName.startsWith('@mui/')) return 'mui-vendor';
          if (packageName === 'recharts') return 'charts-vendor';
          if (packageName.startsWith('@radix-ui/')) return 'radix-vendor';
          return undefined;
        }
      }
    }
  },
})
