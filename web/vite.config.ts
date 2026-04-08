import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite 是前端开发服务器。
// 这里最重要的是 proxy：前端请求 /api 时，会自动转发到本地后端 8787 端口。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
