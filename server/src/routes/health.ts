import type { FastifyInstance } from 'fastify'

export async function registerHealthRoutes(app: FastifyInstance) {
  // health 接口通常用来做“服务活着吗”的快速检查。
  // 前端启动时先请求它，可以更早发现后端没起来。
  app.get('/api/health', async () => {
    return {
      status: 'ok',
      mode: 'mock',
      timestamp: new Date().toISOString(),
    }
  })
}
