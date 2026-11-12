import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 开发时把 /api 代理到 FastAPI；生产构建可直接由任意静态服务器托管，
// 只要把 /api 反代到同一个后端即可。
const backend = process.env.API_ORIGIN ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
    },
  },
})
