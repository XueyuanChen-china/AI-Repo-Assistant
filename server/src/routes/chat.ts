// 导入共享的聊天请求数据验证模式
import { chatRequestSchema } from '@ai-repo-assistant/shared'
// 导入 Fastify 框架的类型定义
import type { FastifyInstance } from 'fastify'

// 导入聊天协调服务中的非流式和流式处理函数
import { runChatTurn, streamChatTurn } from '../services/chatOrchestrator'

// 构建错误消息的辅助函数
function buildErrorMessage(error: unknown) {
  // 如果错误是 Error 实例，则返回其 message 属性
  if (error instanceof Error) {
    return error.message
  }

  // 否则返回通用的错误消息
  return 'Unexpected chat server error.'
}

// 向 SSE（Server-Sent Events）流中写入事件数据的辅助函数
function writeSseEvent(target: NodeJS.WritableStream, payload: unknown) {
  // 按照 SSE 格式写入数据：data: + JSON字符串 + 双换行符
  target.write(`data: ${JSON.stringify(payload)}\n\n`)
}

// 注册聊天相关路由的异步函数
export async function registerChatRoutes(app: FastifyInstance) {
  // 非流式路由 - 用于本地调试的稳定备选方案
  app.post('/api/chat', async (request, reply) => {
    try {
      // 解析并验证请求体数据
      const input = chatRequestSchema.parse(request.body)
      // 执行单次聊天轮次并返回结果
      return await runChatTurn(input)
    } catch (error) {
      // 捕获错误并返回 400 状态码和错误信息
      return reply.status(400).send({
        message: buildErrorMessage(error),
      })
    }
  })

  // 流式路由 - 用于 Day 3 聊天界面
  app.post('/api/chat/stream', async (request, reply) => {
    // 获取原始响应对象
    const rawResponse = reply.raw
    // 劫持响应以便手动写入数据
    reply.hijack()

    // 设置响应头为 SSE 格式
    rawResponse.writeHead(200, {
      // 内容类型为事件流
      'Content-Type': 'text/event-stream; charset=utf-8',
      // 禁止缓存
      'Cache-Control': 'no-cache, no-transform',
      // 保持连接活跃
      Connection: 'keep-alive',
      // 禁用服务器端缓冲
      'X-Accel-Buffering': 'no',
    })

    try {
      // 解析并验证请求体数据
      const input = chatRequestSchema.parse(request.body)
      // 执行流式聊天轮次，并传入回调函数处理各类事件
      const result = await streamChatTurn(input, {
        // 当接收到上下文信息时的回调
        onContext: (contextMeta) => {
          writeSseEvent(rawResponse, {
            type: 'context',
            contextMeta,
          })
        },
        // 当接收到聊天内容块时的回调
        onChunk: (chunk) => {
          writeSseEvent(rawResponse, {
            type: 'chunk',
            content: chunk,
          })
        },
      })

      // 发送完成事件，包含最终结果数据
      writeSseEvent(rawResponse, {
        type: 'done',
        reply: result.reply,
        diffPreviews: result.diffPreviews,
        pendingSuggestions: result.pendingSuggestions,
        contextMeta: result.contextMeta,
      })
    } catch (error) {
      // 发送错误事件
      writeSseEvent(rawResponse, {
        type: 'error',
        message: buildErrorMessage(error),
      })
    } finally {
      // 最终关闭响应流
      rawResponse.end()
    }
  })
}
