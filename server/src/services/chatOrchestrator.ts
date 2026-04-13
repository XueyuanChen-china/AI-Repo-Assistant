import { chatResponseSchema, type ChatRequest, type ChatResponse, type ChatContextMeta, type WorkspaceMessage } from '@ai-repo-assistant/shared'

import { generateChatCompletion, streamChatCompletion } from './aiService'
import { buildContextPayload } from './contextBuilder'
import { buildChatMessages } from './promptBuilder'

type StreamChatHandlers = {
  onContext: (contextMeta: ChatContextMeta) => void
  onChunk: (chunk: string) => void
}

function buildAssistantMessage(content: string): WorkspaceMessage {
  return {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: content.trim() || 'The model returned an empty response.',
    createdAt: new Date().toISOString(),
  }
}

export async function runChatTurn(input: ChatRequest): Promise<ChatResponse> {
  const context = buildContextPayload(input.contextFiles)
  const messages = buildChatMessages({ input, contextText: context.contextText })
  const replyText = await generateChatCompletion(messages)

  return chatResponseSchema.parse({
    reply: buildAssistantMessage(replyText),
    diffPreview: null,
    contextMeta: context.contextMeta,
  })
}

export async function streamChatTurn(input: ChatRequest, handlers: StreamChatHandlers): Promise<ChatResponse> {
  const context = buildContextPayload(input.contextFiles)
  const messages = buildChatMessages({ input, contextText: context.contextText })

  handlers.onContext(context.contextMeta)
  const replyText = await streamChatCompletion(messages, {
    onToken: handlers.onChunk,
  })

  return chatResponseSchema.parse({
    reply: buildAssistantMessage(replyText),
    diffPreview: null,
    contextMeta: context.contextMeta,
  })
}