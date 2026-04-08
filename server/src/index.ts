import Fastify from 'fastify'

import { registerCors } from './plugins/cors'
import { registerChatRoutes } from './routes/chat'
import { registerHealthRoutes } from './routes/health'
import { registerRepoRoutes } from './routes/repo'

// server/src/index.ts 是后端入口文件。
// 现在它做的事情很简单：创建 Fastify 实例，然后把各类路由注册进去。
const app = Fastify({
  logger:true
})
// 这里的顺序不复杂，但思路上是“先公共能力，再具体业务路由”。
await registerCors(app)
await registerHealthRoutes(app)
await registerRepoRoutes(app)
await registerChatRoutes(app)

try {
  await app.listen({
    host: '0.0.0.0',
    port: 8787,
  })

  app.log.info('AI Repo Assistant server is running at http://localhost:8787')
} catch (error) {
  app.log.error(error)
  throw error
}
