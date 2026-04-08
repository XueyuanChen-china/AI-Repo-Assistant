import { chatRequestSchema, chatResponseSchema } from '@ai-repo-assistant/shared'
import type { FastifyInstance } from 'fastify'

import { buildMockChatResponse } from '../data/mockRepo'

export async function registerChatRoutes(app: FastifyInstance) {
  // 这里是中间聊天面板的核心接口。
  // Day 1 还没有接真实模型，所以这里只做两件事：校验输入、返回 mock 回复。
  app.post('/api/chat', async (request) => {
    const input = chatRequestSchema.parse(request.body)
    return chatResponseSchema.parse(buildMockChatResponse(input))
  })
}
