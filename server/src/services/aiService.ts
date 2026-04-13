import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ChatModelMessage } from './promptBuilder'

// 流处理的回调函数类型定义
type StreamHandlers = {
  onToken: (token: string) => void
}

// 聊天完成的响应数据类型定义
type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>
    }
  }>
  error?: {
    message?: string
  }
}

// 获取当前服务目录的绝对路径
const serviceDirectory = fileURLToPath(new URL('.', import.meta.url))
// 获取服务器根目录路径（上级目录）
const serverRoot = path.resolve(serviceDirectory, '..', '..')
// 获取工作区根目录路径（再上级目录）
const workspaceRoot = path.resolve(serverRoot, '..')

/**
 * 解析 .env 文件中的单行配置
 * @param line - 待解析的行内容
 * @returns 解析结果，包含 key 和 value，或 null
 */
function parseEnvLine(line: string) {
  const trimmedLine = line.trim()

  // 跳过空行和注释行
  if (!trimmedLine || trimmedLine.startsWith('#')) {
    return null
  }

  // 查找等号位置
  const separatorIndex = trimmedLine.indexOf('=')

  if (separatorIndex === -1) {
    return null
  }

  // 提取键名
  const key = trimmedLine.slice(0, separatorIndex).trim()
  // 提取键值
  let value = trimmedLine.slice(separatorIndex + 1).trim()

  // 移除引号（支持单引号和双引号）
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }

  return {
    key,
    value,
  }
}

/**
 * 从 .env 文件加载环境变量
 * Bun 通常会自动加载 .env，但工作区过滤器并不总是可预测的。
 * 此函数作为后备方案，显式从根目录和服务器文件夹读取 env 文件。
 */
function loadEnvFromFiles() {
  // 候选 .env 文件路径列表（优先级从高到低）
  const envCandidates = [
    path.join(workspaceRoot, '.env'),
    path.join(serverRoot, '.env'),
  ]

  for (const filePath of envCandidates) {
    // 文件不存在则跳过
    if (!existsSync(filePath)) {
      continue
    }

    // 读取文件内容
    const content = readFileSync(filePath, 'utf8')
    // 按行分割
    const lines = content.split(/\r?\n/)

    for (const line of lines) {
      const parsed = parseEnvLine(line)

      if (!parsed) {
        continue
      }

      // 仅在环境变量不存在时才设置（避免覆盖已有的配置）
      if (!(parsed.key in process.env)) {
        process.env[parsed.key] = parsed.value
      }
    }
  }
}

// 启动时加载环境变量
loadEnvFromFiles()

/**
 * 获取 DashScope 配置信息
 * @returns 包含 API 密钥、基础 URL 和模型名称的配置对象
 * @throws 当缺少必需的 API 密钥时抛出错误
 */
function getDashScopeConfig() {
  const apiKey = process.env.DASHSCOPE_API_KEY
  // 基础 URL，移除末尾斜杠以保证格式一致
  const baseUrl = (process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')
  // 使用的 AI 模型，默认为 qwen-turbo
  const model = process.env.DASHSCOPE_MODEL || 'qwen-turbo'

  if (!apiKey) {
    throw new Error('Missing DASHSCOPE_API_KEY. Add it to your local environment before starting the server.')
  }

  return {
    apiKey,
    baseUrl,
    model,
  }
}

/**
 * 从 API 响应中提取助手的文本内容
 * @param payload - API 返回的响应数据
 * @returns 提取的文本内容
 */
function extractAssistantText(payload: ChatCompletionResponse) {
  // 获取第一个选择项中的消息内容
  const messageContent = payload.choices?.[0]?.message?.content

  // 如果是字符串直接返回
  if (typeof messageContent === 'string') {
    return messageContent
  }

  // 如果是数组格式，提取所有 text 字段并拼接
  if (Array.isArray(messageContent)) {
    return messageContent.map((item) => item.text || '').join('')
  }

  return ''
}

/**
 * 创建聊天完成请求
 * @param messages - 聊天消息列表
 * @param stream - 是否使用流式响应
 * @returns 返回 Response 对象
 * @throws API 请求失败时抛出错误
 */
async function createChatCompletionRequest(messages: ChatModelMessage[], stream: boolean) {
  const config = getDashScopeConfig()

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      stream,
      temperature: 0.2,
      messages,
    }),
  })

  // 请求失败处理
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `DashScope request failed with status ${response.status}`)
  }

  return response
}

/**
 * 生成聊天完成（非流式）
 * @param messages - 聊天消息列表
 * @returns 返回 AI 的完整响应文本
 */
export async function generateChatCompletion(messages: ChatModelMessage[]) {
  const response = await createChatCompletionRequest(messages, false)
  const payload = (await response.json()) as ChatCompletionResponse

  // 检查是否有错误
  if (payload.error?.message) {
    throw new Error(payload.error.message)
  }

  return extractAssistantText(payload).trim()
}

/**
 * 流式生成聊天完成
 * 通过事件流逐个返回 token，适合实时显示 AI 回复
 * @param messages - 聊天消息列表
 * @param handlers - 包含回调函数的处理器对象
 * @returns 返回 AI 的完整响应文本
 */
export async function streamChatCompletion(messages: ChatModelMessage[], handlers: StreamHandlers) {
  const response = await createChatCompletionRequest(messages, true)

  // 验证响应体是否存在
  if (!response.body) {
    throw new Error('The model response did not include a readable stream.')
  }

  // 创建流读取器
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '' // 缓存未完成的数据块
  let fullText = '' // 累积完整的响应文本

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    // 将二进制数据解码为文本并添加到缓冲区
    buffer += decoder.decode(value, { stream: true })

    // 处理缓冲区中的完整事件（以 \n\n 分隔）
    while (true) {
      const boundaryIndex = buffer.indexOf('\n\n')

      // 没有完整事件，等待下一个数据块
      if (boundaryIndex === -1) {
        break
      }

      // 提取一个完整事件
      const rawEvent = buffer.slice(0, boundaryIndex)
      // 移除已处理的事件，保留剩余数据到下一次迭代
      buffer = buffer.slice(boundaryIndex + 2)

      // 提取 data: 开头的行并移除前缀
      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      for (const line of dataLines) {
        if (!line) {
          continue
        }

        // 检查流是否结束
        if (line === '[DONE]') {
          return fullText.trim()
        }

        // 解析 JSON 格式的事件数据
        const payload = JSON.parse(line) as {
          error?: { message?: string }
          choices?: Array<{
            delta?: { content?: string }
          }>
        }

        // 检查错误
        if (payload.error?.message) {
          throw new Error(payload.error.message)
        }

        // 提取当前 token（可能为空）
        const token = payload.choices?.[0]?.delta?.content || ''

        if (!token) {
          continue
        }

        // 累积完整文本并触发回调
        fullText += token
        handlers.onToken(token)
      }
    }
  }

  return fullText.trim()
}