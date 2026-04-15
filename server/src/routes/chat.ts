import { chatRequestSchema } from '@ai-repo-assistant/shared'
import type { FastifyInstance } from 'fastify'

import { runChatTurn, streamChatTurn } from '../services/chatOrchestrator'

function buildErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected chat server error.'
}

function writeSseEvent(target: NodeJS.WritableStream, payload: unknown) {
  target.write(`data: ${JSON.stringify(payload)}\n\n`)
}

export async function registerChatRoutes(app: FastifyInstance) {
  // Non-streaming route kept as a stable fallback for local debugging.
  app.post('/api/chat', async (request, reply) => {
    try {
      const input = chatRequestSchema.parse(request.body)
      return await runChatTurn(input)
    } catch (error) {
      return reply.status(400).send({
        message: buildErrorMessage(error),
      })
    }
  })

  // Streaming route used by the Day 3 chat UI.
  app.post('/api/chat/stream', async (request, reply) => {
    const rawResponse = reply.raw
    reply.hijack()

    rawResponse.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    try {
      const input = chatRequestSchema.parse(request.body)
      const result = await streamChatTurn(input, {
        onContext: (contextMeta) => {
          writeSseEvent(rawResponse, {
            type: 'context',
            contextMeta,
          })
        },
        onChunk: (chunk) => {
          writeSseEvent(rawResponse, {
            type: 'chunk',
            content: chunk,
          })
        },
      })

      writeSseEvent(rawResponse, {
        type: 'done',
        reply: result.reply,
        diffPreviews: result.diffPreviews,
        pendingSuggestions: result.pendingSuggestions,
        contextMeta: result.contextMeta,
      })
    } catch (error) {
      writeSseEvent(rawResponse, {
        type: 'error',
        message: buildErrorMessage(error),
      })
    } finally {
      rawResponse.end()
    }
  })
}
