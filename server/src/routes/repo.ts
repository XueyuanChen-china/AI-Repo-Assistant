import { repoFileResponseSchema, repoTreeResponseSchema } from '@ai-repo-assistant/shared'
import type { FastifyInstance } from 'fastify'

import { getMockFile, mockRepoNodes, mockRepoRoot } from '../data/mockRepo'

export async function registerRepoRoutes(app: FastifyInstance) {
  // 这个接口给左侧文件树用。
  // Day 1 先直接返回内存里的 mock 数据，Day 2 再换成真实文件系统遍历。
  app.get('/api/repo/tree', async () => {
    return repoTreeResponseSchema.parse({
      root: mockRepoRoot,
      nodes: mockRepoNodes,
    })
  })

  // 这个接口给右侧代码预览用。
  // 前端点一个文件，就拿 path 来这里换取真正的内容。
  app.get('/api/repo/file', async (request, reply) => {
    const query = request.query as { path?: string }

    if (!query.path) {
      return reply.status(400).send({
        message: 'Missing required query parameter: path',
      })
    }

    const file = getMockFile(query.path)

    if (!file) {
      return reply.status(404).send({
        message: `Mock file not found for path: ${query.path}`,
      })
    }

    return repoFileResponseSchema.parse({ file })
  })
}
