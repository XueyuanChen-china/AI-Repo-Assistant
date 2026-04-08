import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'

export async function registerCors(app: FastifyInstance) {
  // Web 前端运行在 Vite 开发端口，后端运行在 8787。
  // 浏览器默认会拦截跨域请求，所以这里先放开，方便 Day 1 本地联调。
  await app.register(cors, {
    origin: true,
  })
}
