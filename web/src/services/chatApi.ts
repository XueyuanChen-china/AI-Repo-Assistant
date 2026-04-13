import {
  chatResponseSchema,
  chatStreamEventSchema,
  type ChatRequest,
  type ChatResponse,
  type ChatStreamEvent,
  type SelectedContextFile,
} from '@ai-repo-assistant/shared'

import { readSelectedRepoFile } from './localRepoService'

type StreamHandlers = {
  onEvent: (event: ChatStreamEvent) => void
}

export async function buildChatRequestPayload(message: string, selectedPaths: string[]): Promise<ChatRequest> {
  const contextFiles: SelectedContextFile[] = []

  for (const path of selectedPaths) {
    try {
      const file = await readSelectedRepoFile(path)
      contextFiles.push(file)
    } catch {
      // Ignore individual file read failures so the whole request can still continue.
    }
  }

  return {
    message,
    selectedPaths,
    contextFiles,
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
  const response = await readJson('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return chatResponseSchema.parse(response)
}
// 流式
export async function streamChatRequest(payload: ChatRequest, handlers: StreamHandlers) {
  const response = await fetch('/api/chat/stream', {
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
    //stream:true选项告诉TextDecoder在每次解码时保留未完成的多字节字符，直到下一个数据块到达。
    // 这对于处理流式数据非常重要，因为数据块可能会在字符边界处分割。
    buffer += decoder.decode(value, { stream: true })
    //buffer中可能包含一个或多个完整的事件，事件之间以两个连续的换行符（\n\n）分隔。
    //也可能事半个事件
    while (true) {
      // 查找事件边界（两个连续的换行符）
      const boundaryIndex = buffer.indexOf('\n\n')

      if (boundaryIndex === -1) {
        break
      }

      const rawEvent = buffer.slice(0, boundaryIndex)
      buffer = buffer.slice(boundaryIndex + 2)
      // 每个事件可能包含多行数据，每行以 "data:" 开头。我们需要提取这些行并解析它们。
      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
      //跳过空行
      for (const line of dataLines) {
        if (!line) {
          continue
        }
        // 解析事件数据并调用处理程序
        handlers.onEvent(chatStreamEventSchema.parse(JSON.parse(line)))
      }
    }
  }
}