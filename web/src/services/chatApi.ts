import {
  chatResponseSchema,
  chatStreamEventSchema,
  type ChatRequest,
  type ChatResponse,
  type ChatStreamEvent,
  type SelectedContextFile,
  type WorkspaceMessage,
} from '@ai-repo-assistant/shared'

import { withApiBase } from './apiBase'
import { readSelectedRepoFile } from './localRepoService'

type StreamHandlers = {
  onEvent: (event: ChatStreamEvent) => void
}

export async function buildChatRequestPayload(
  message: string,
  selectedPaths: string[],
  historyMessages: WorkspaceMessage[] = [],
): Promise<ChatRequest> {
  const contextFiles: SelectedContextFile[] = []

  for (const path of selectedPaths) {
    try {
      const file = await readSelectedRepoFile(path)
      contextFiles.push(file)
    } catch {
      // 单个文件读取失败时不打断整次请求，避免因为一个文件异常导致整轮对话失败。
    }
  }

  return {
    message,
    selectedPaths,
    contextFiles,
    historyMessages,
  }
}

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

export async function sendChatRequest(payload: ChatRequest): Promise<ChatResponse> {
  const response = await readJson(withApiBase('/api/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return chatResponseSchema.parse(response)
}

export async function streamChatRequest(payload: ChatRequest, handlers: StreamHandlers) {
  const response = await fetch(withApiBase('/api/chat/stream'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  if (!response.body) {
    throw new Error('The browser could not read the streaming response body.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }
    //{ stream: true }暂存不完整的字节 等下一块数据来拼接
    buffer += decoder.decode(value, { stream: true })

    while (true) {
      //\n\n作为事件边界，解析出完整事件后调用一次handlers.onEvent，剩余部分继续等待后续数据拼接
      //data: {"type":"token","content":"你"}\n\ndata: {"type":"token","content":"好"}\n\n
      //data: {"type":"token","content":"你"}\n\n
      //data: {"type":"token",
      const boundaryIndex = buffer.indexOf('\n\n')

      if (boundaryIndex === -1) {
        break
      }

      const rawEvent = buffer.slice(0, boundaryIndex)
      buffer = buffer.slice(boundaryIndex + 2)

      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      for (const line of dataLines) {
        if (!line) {
          continue
        }

        handlers.onEvent(chatStreamEventSchema.parse(JSON.parse(line)))
      }
    }
  }
}
