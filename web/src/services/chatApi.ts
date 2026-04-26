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
import { isStringOneByteRepresentation } from 'node:v8'

/**
 * 流式聊天请求的事件处理器。
 *
 * 当前前端并不直接依赖原始 SSE 文本，而是先在这一层把服务端返回的
 * `context / chunk / done / error` 事件解析成结构化对象，再交给页面和 store。
 * 这样上层只需要关注“收到什么事件”，不需要关心底层如何拆包。
 */
type StreamHandlers = {
  onEvent: (event: ChatStreamEvent) => void
}

/**
 * 首包超时：
 * 发起流式请求后，如果在这个时间内连第一个 SSE 事件都收不到，
 * 说明链路大概率卡住了，此时主动中断请求，交给上层走 fallback。
 */
const FIRST_STREAM_EVENT_TIMEOUT_MS = 10_000

/**
 * 空闲超时：
 * 流式响应已经开始返回内容后，如果长时间没有新的数据块进来，
 * 说明连接可能卡住或中断了，也应该主动结束，避免用户一直卡在 loading。
 */
const STREAM_IDLE_TIMEOUT_MS = 20_000

/**
 * 构建聊天请求体。
 *
 * 这个项目的一个关键点是：不是只把“文件路径”传给后端，而是前端先从本地仓库
 * 读取出用户选中的文件内容，再把这些内容随当前问题一起发给后端。
 *
 * 这样做的原因有两个：
 * 1. 本地仓库选择与文件句柄能力掌握在浏览器侧，后端并不能直接访问用户电脑文件系统。
 * 2. 后端可以专心做上下文预算控制、prompt 组装和模型调用，不必再反查前端选中的文件内容。
 *
 * 注意：
 * 单个文件读取失败时，这里不会让整次请求直接失败，而是“尽量带上能读到的上下文继续请求”。
 * 这是一个偏体验优先的选择，避免因为某一个句柄失效，就让整轮对话都无法发送。
 */
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

/**
 * 通用 JSON 请求辅助函数。
 *
 * 这个函数用于非流式接口，例如 `/api/chat`。
 * 它统一处理三件事：
 * 1. 发起 fetch
 * 2. 检查 HTTP 状态码是否成功
 * 3. 返回解析后的 JSON
 *
 * 如果服务端返回非 2xx 状态，会优先读取响应体文本作为错误信息，
 * 这样上层拿到的错误会比简单的状态码更容易定位问题。
 */
async function readJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

/**
 * 发送非流式聊天请求。
 *
 * 这条链路主要作为两类场景使用：
 * 1. 本地调试或直接获取完整回答
 * 2. SSE 流式请求失败后的降级兜底
 *
 * 请求完成后会再用 zod schema 做一次结构校验，
 * 避免服务端返回格式异常时直接污染上层状态。
 */
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

/**
 * 发送流式聊天请求，并手动解析 SSE 事件流。
 *
 * 为什么这里不用 `EventSource`：
 * 1. 当前接口是 `POST`，而原生 `EventSource` 只支持 `GET`
 * 2. 我们需要自定义请求体，把当前问题、上下文文件和历史消息一起发送给后端
 * 3. 我们希望把超时、降级和错误处理控制在同一条 fetch 链路里
 *
 * 这段逻辑的核心职责是：
 * 1. 发起 `/api/chat/stream` 请求
 * 2. 按 SSE 协议手动拆分 `data: ...` 事件
 * 3. 将事件解析成结构化对象后交给上层
 * 4. 对“首包太慢”和“流中空闲太久”两个高频异常场景做主动超时控制
 */
export async function streamChatRequest(payload: ChatRequest, handlers: StreamHandlers) {
  /**
   * AbortController 用于超时后主动取消 fetch。
   */
  const controller = new AbortController()

  /**
   * reader 用来逐块读取 response.body。
   */
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  /**
   * 是否已经收到过第一个合法 SSE 事件。
   */
  let hasReceivedFirstEvent = false

  //最近一次收到流数据的时间戳。
  let lastActivityAt = Date.now()

   //记录本次终止的原因，便于在 catch 中转换成更明确的错误信息。
  let timeoutReason: 'first-event-timeout' | 'idle-timeout' | null = null

  /**
   * 首包超时：
   */
  const firstEventTimer = window.setTimeout(() => {
    if (hasReceivedFirstEvent) {
      return
    }

    timeoutReason = 'first-event-timeout'
    controller.abort()
  }, FIRST_STREAM_EVENT_TIMEOUT_MS)

  /**
   * 空闲超时：
   */
  const idleTimer = window.setInterval(() => {
    if (!hasReceivedFirstEvent) {
      return
    }

    if (Date.now() - lastActivityAt < STREAM_IDLE_TIMEOUT_MS) {
      return
    }

    timeoutReason = 'idle-timeout'
    controller.abort()
  }, 1_000)

  try {
    /**
     * 用 Performance API 记录“发起流式请求”的时间点。
     * 后面第一条非空 chunk 到达时，会和这里做差值来计算 TTFT（首个 token 延迟）。
     */
    const startedAt = performance.now()
    let hasLoggedFirstChunkTiming = false

    const response = await fetch(withApiBase('/api/chat/stream'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Request failed with status ${response.status}`)
    }

    if (!response.body) {
      throw new Error('The browser could not read the streaming response body.')
    }

    reader = response.body.getReader()
    const decoder = new TextDecoder()

    /**
     * buffer 用来暂存尚未拼成完整 SSE 事件的数据。
     *
     * 原因是浏览器每次 read() 拿到的是“字节块”，而不是“完整事件”。
     * 一个 SSE 事件可能被拆成多次返回，所以必须先缓存在 buffer 里，
     * 再按 `\n\n` 这个事件边界去切分。
     */
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      lastActivityAt = Date.now()
      buffer += decoder.decode(value, { stream: true })

      while (true) {
        /**
         * SSE 事件之间以空行分隔，即 `\n\n`。
         * 只有找到完整边界，才能说明当前 buffer 至少包含一个完整事件。
         */
        const boundaryIndex = buffer.indexOf('\n\n')

        if (boundaryIndex === -1) {
          break
        }

        const rawEvent = buffer.slice(0, boundaryIndex)
        buffer = buffer.slice(boundaryIndex + 2)

        /**
         * 一个 SSE 事件可能包含多行，这里只取 `data:` 开头的内容。
         * 服务端当前协议里每个事件最终都是一段 JSON，所以会继续 JSON.parse。
         */
        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())

        for (const line of dataLines) {
          if (!line) {
            continue
          }

          /**
           * 收到首个有效事件后：
           * 1. 标记流已经真正开始
           * 2. 清掉首包超时，避免后续被误触发
           */
          if (!hasReceivedFirstEvent) {
            hasReceivedFirstEvent = true
            window.clearTimeout(firstEventTimer)
          }

          lastActivityAt = Date.now()

          /**
           * 先做 JSON.parse，再交给 zod schema 校验。
           *
           * 这样上层不会拿到一坨未经验证的任意数据，
           * 有助于把协议错误尽量收敛在这一层。
           */
          const event = chatStreamEventSchema.parse(JSON.parse(line))

          /**
           * 只在第一条非空 chunk 到达时打印一次 TTFT。
           * 这里不用首个 context 事件计时，是因为我们要测的是模型首个 token 的返回时间。
           */
          if (
            !hasLoggedFirstChunkTiming &&
            event.type === 'chunk' &&
            event.content.trim().length > 0
          ) {
            const firstChunkAt = performance.now()
            hasLoggedFirstChunkTiming = true
            console.log('[stream] TTFT(ms):', Math.round(firstChunkAt - startedAt))
          }

          handlers.onEvent(event)
        }
      }
    }
  } catch (error) {
    /**
     * 如果是我们主动触发的超时中断，就把错误翻译成更具体的 message，
     * 方便页面层区分：
     * - 首包太慢
     * - 流到一半卡住
     *
     * 页面层收到这些错误后，会沿用现有逻辑自动降级到非流式请求。
     */
    if (timeoutReason === 'first-event-timeout') {
      throw new Error(
        `The streaming response did not receive its first event within ${FIRST_STREAM_EVENT_TIMEOUT_MS / 1000} seconds.`,
      )
    }

    if (timeoutReason === 'idle-timeout') {
      throw new Error(
        `The streaming response was idle for more than ${STREAM_IDLE_TIMEOUT_MS / 1000} seconds.`,
      )
    }

    throw error
  } finally {
    /**
     * 无论请求成功、失败还是超时，都统一清理定时器，避免残留。
     */
    window.clearTimeout(firstEventTimer)
    window.clearInterval(idleTimer)

    if (reader) {
      try {
        /**
         * 主动取消 reader，帮助浏览器尽快回收底层流资源。
         * 如果流已经正常结束，这一步可能抛错，直接忽略即可。
         */
        await reader.cancel()
      } catch {
        // 流已经自然结束时，清理失败可以安全忽略。
      }
    }
  }
}
