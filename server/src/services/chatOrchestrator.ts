import {
  chatResponseSchema,
  type ChatContextMeta,
  type ChatRequest,
  type ChatResponse,
  type DiffPreview,
  type PendingSuggestion,
  type SelectedContextFile,
  type WorkspaceMessage,
} from '@ai-repo-assistant/shared'

import { generateChatCompletion, streamChatCompletion } from './aiService'
import { buildContextPayload } from './contextBuilder'
import { buildChatMessages } from './promptBuilder'

// 流式聊天的回调处理器
type StreamChatHandlers = {
  onContext: (contextMeta: ChatContextMeta) => void
  onChunk: (chunk: string) => void
}

// AI 模型提取的代码建议
type ExtractedSuggestion = {
  updatedContent: string
  targetFilePath: string
  summary: string
}

// 最终的建议负载，包含 diff 预览、待批准建议和被拒绝的数量
type SuggestionPayload = {
  diffPreviews: DiffPreview[]
  pendingSuggestions: PendingSuggestion[]
  rejectedCount: number
}

// 从代码块中提取的文件信息
type FallbackCodeBlock = {
  code: string
  fileHint: string | null
}

// 构建助手响应消息
function buildAssistantMessage(content: string): WorkspaceMessage {
  return {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: content.trim() || 'The model returned an empty response.',
    createdAt: new Date().toISOString(),
  }
}

// 规范化文件路径：转换为正斜杠并小写
function normalizeRepoPath(filePath: string) {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

// 从上下文文件列表中匹配目标路径
// 支持后缀匹配和文件名匹配
function mapTargetPath(contextFiles: SelectedContextFile[], targetPath: string) {
  const normalizedTarget = normalizeRepoPath(targetPath)
  const targetBaseName = normalizedTarget.split('/').pop()

  // 第一步：尝试路径后缀匹配
  const suffixMatch = contextFiles.find((file) => {
    const normalizedPath = normalizeRepoPath(file.path)
    return normalizedPath.endsWith(normalizedTarget) || normalizedTarget.endsWith(normalizedPath)
  })

  if (suffixMatch) {
    return suffixMatch.path
  }

  // 第二步：尝试文件名（basename）匹配
  if (targetBaseName) {
    const basenameMatches = contextFiles.filter((file) => {
      const fileName = normalizeRepoPath(file.path).split('/').pop()
      return fileName === targetBaseName
    })

    if (basenameMatches.length === 1) {
      return basenameMatches[0].path
    }
  }

  // 兜底：返回原始路径（已规范化）
  return targetPath.replace(/\\/g, '/')
}

// 从 AI 响应中提取 Markdown 代码块
// 同时尝试识别代码块前面是否有文件名提示
// 从 AI 响应中提取 Markdown 代码块，并尝试识别每个代码块前面是否有文件名提示
// 主要用于模型未严格使用 CODE_SUGGESTION 块时的兜底处理
// 处理流程：
// 1. 使用正则表达式全局匹配所有 Markdown 代码块（```[语言]?\n...```）
// 2. 对于每个代码块，回溯其前面最多 3 行文本，尝试查找类似 "xxx.ts:" 或 `xxx.ts` 这样的文件名提示
//    - 这样可以关联代码块和具体的文件，便于后续定位和建议应用
// 3. 如果找到文件名提示，则作为 fileHint 返回，否则 fileHint 为 null
// 4. 返回所有提取到的代码块及其可能的文件名提示
function extractMarkdownCodeBlocks(aiResponse: string): FallbackCodeBlock[] {
  const blocks: FallbackCodeBlock[] = []
  // 匹配 Markdown 代码块，支持可选的语言标记
  const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)```/g

  for (const match of aiResponse.matchAll(codeBlockRegex)) {
    const code = match[1]?.trim()

    if (!code) {
      continue
    }

    // 回溯代码块前最多 3 行，尝试识别文件名提示
    const beforeText = aiResponse.slice(0, match.index ?? 0)
    const recentLines = beforeText.split(/\r?\n/).slice(-3).reverse()

    let fileHint: string | null = null
    for (const line of recentLines) {
      const trimmedLine = line.trim()

      if (!trimmedLine) {
        continue
      }

      // 匹配形如 "mathHelpers.ts:"、"`mathHelpers.ts`:"、"mathHelpers.ts" 等文件名标记
      const fileMatch = trimmedLine.match(/`?([A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|json|css|scss|md|html))`?:?$/)
      if (fileMatch) {
        fileHint = fileMatch[1]
        break
      }
    }

    blocks.push({
      code,
      fileHint,
    })
  }

  return blocks
}

// 从 AI 响应中提取代码建议
// 支持多种格式：1) 正式的 CODE_SUGGESTION 块 2) 文件名+代码块 3) 单文件场景的简单代码块
function extractSuggestions(aiResponse: string, contextFiles: SelectedContextFile[]): ExtractedSuggestion[] {
  const suggestions: ExtractedSuggestion[] = []
  const suggestionRegex =
    /CODE_SUGGESTION_START[\s\S]*?Target Path: ([^\r\n]+)[\s\S]*?Summary: ([^\r\n]+)[\s\S]*?```(?:\w+\n)?([\s\S]*?)```[\s\S]*?CODE_SUGGESTION_END/g

  // 第一阶段：尝试提取正式格式的建议
  for (const match of aiResponse.matchAll(suggestionRegex)) {
    const rawTargetPath = match[1]?.trim()
    const rawSummary = match[2]?.trim()
    const rawContent = match[3]?.trim()

    if (!rawTargetPath || !rawContent) {
      continue
    }

    suggestions.push({
      targetFilePath: mapTargetPath(contextFiles, rawTargetPath),
      summary: rawSummary || `Suggested changes to ${rawTargetPath}`,
      updatedContent: rawContent,
    })
  }

  // 兜底 1：模型偷懒返回"文件名标题 + 普通代码块"时的恢复
  if (suggestions.length === 0) {
    const fallbackBlocks = extractMarkdownCodeBlocks(aiResponse)

    for (const block of fallbackBlocks) {
      const targetFilePath = block.fileHint
        ? mapTargetPath(contextFiles, block.fileHint)
        : contextFiles.length === 1
          ? contextFiles[0].path
          : null

      if (!targetFilePath) {
        continue
      }

      suggestions.push({
        targetFilePath,
        updatedContent: block.code,
        summary: `Suggested changes to ${targetFilePath}`,
      })
    }
  }

  // 兜底 2：单文件场景下，允许把唯一代码块当作该文件的完整建议
  if (suggestions.length === 0) {
    const codeBlockRegex = /```(?:\w+\n)?([\s\S]*?)```/
    const codeMatch = aiResponse.match(codeBlockRegex)

    if (codeMatch) {
      const extractedCode = codeMatch[1]?.trim()

      if (extractedCode && contextFiles.length === 1) {
        suggestions.push({
          targetFilePath: contextFiles[0].path,
          updatedContent: extractedCode,
          summary: `Suggested changes to ${contextFiles[0].path}`,
        })
      }
    }
  }

  return suggestions
}

// 从 AI 响应中移除代码建议块，并清理多余的空行
function stripSuggestionBlocks(aiResponse: string) {
  return aiResponse
    .replace(/CODE_SUGGESTION_START[\s\S]*?CODE_SUGGESTION_END/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 检查建议内容是否看起来被截断了
// 保守的启发式方法：原文件较长但建议内容短得离谱，可能是输出被截断
function looksSuspiciouslyIncomplete(originalContent: string, updatedContent: string) {
  const originalLength = originalContent.trim().length
  const updatedLength = updatedContent.trim().length

  if (updatedLength === 0) {
    return true
  }

  // 原文件 >= 300 字符，但建议内容不足 45%，则认为可疑
  if (originalLength >= 300 && updatedLength < originalLength * 0.45) {
    return true
  }

  return false
}

// 为代码建议生成 diff 预览
function generateDiffPreview(originalContent: string, updatedContent: string, filePath: string, summary: string): DiffPreview {
  return {
    path: filePath,
    title: `修改建议: ${filePath}`,
    summary: summary || `查看 ${filePath} 的建议变更`,
    before: originalContent,
    after: updatedContent,
  }
}

// 构建建议负载：验证、过滤建议，生成 diff 预览和待批准列表
function buildSuggestionPayload(contextFiles: SelectedContextFile[], replyText: string): SuggestionPayload {
  const diffPreviews: DiffPreview[] = []
  const pendingSuggestions: PendingSuggestion[] = []
  const extractedSuggestions = extractSuggestions(replyText, contextFiles)
  let rejectedCount = 0

  for (const suggestion of extractedSuggestions) {
    const originalFile = contextFiles.find((file) => file.path === suggestion.targetFilePath)

    // 安全检查1：只能修改已选中的上下文文件
    if (!originalFile) {
      rejectedCount += 1
      continue
    }

    // 安全检查2：被截断的建议不能进入审批流程
    if (looksSuspiciouslyIncomplete(originalFile.content, suggestion.updatedContent)) {
      rejectedCount += 1
      continue
    }

    try {
      diffPreviews.push(
        generateDiffPreview(
          originalFile.content,
          suggestion.updatedContent,
          suggestion.targetFilePath,
          suggestion.summary,
        ),
      )

      pendingSuggestions.push({
        targetPath: suggestion.targetFilePath,
        updatedContent: suggestion.updatedContent,
        summary: suggestion.summary,
      })
    } catch (error) {
      rejectedCount += 1
      console.warn('Failed to build diff preview:', error)
    }
  }

  return {
    diffPreviews,
    pendingSuggestions,
    rejectedCount,
  }
}

// 为用户构建可见的聊天回复
// 如果已提取出建议，优先显示简洁版本，避免重复显示代码块
function buildVisibleReply(replyText: string, suggestionPayload: SuggestionPayload) {
  const strippedReply = stripSuggestionBlocks(replyText)

  // 有建议且去除建议块后仍有代码块，则显示简洁提示
  if (suggestionPayload.pendingSuggestions.length > 0 && strippedReply.includes('```')) {
    return `已生成 ${suggestionPayload.pendingSuggestions.length} 条代码建议。请在差异面板中查看。`
  }

  // 去除建议块后有内容，则返回清理后的文本
  if (strippedReply) {
    return strippedReply
  }

  // 如果如果只有代码块建议且没有其他文本内容，则返回简洁提示
  if (suggestionPayload.pendingSuggestions.length > 0) {
    return `已生成 ${suggestionPayload.pendingSuggestions.length} 条代码建议。请在差异面板中查看。`
  }

  // 如果有被拒绝的建议，说明原因
  if (suggestionPayload.rejectedCount > 0) {
    return 'AI 返回了代码建议块，但内容不完整或与选中的文件不匹配，已被忽略。'
  }

  // 兜底：返回原始回复
  return replyText
}

// 执行单轮聊天，返回完整的响应（包含回复和代码建议）
export async function runChatTurn(input: ChatRequest): Promise<ChatResponse> {
  const context = buildContextPayload(input.contextFiles)
  const messages = buildChatMessages({ input, contextText: context.contextText })
  const replyText = await generateChatCompletion(messages)
  const suggestionPayload = buildSuggestionPayload(input.contextFiles, replyText)
  const visibleReply = buildVisibleReply(replyText, suggestionPayload)

  return chatResponseSchema.parse({
    reply: buildAssistantMessage(visibleReply),
    diffPreviews: suggestionPayload.diffPreviews,
    pendingSuggestions: suggestionPayload.pendingSuggestions,
    contextMeta: context.contextMeta,
  })
}

// 执行单轮流式聊天（逐 token 返回），最终返回完整响应
export async function streamChatTurn(input: ChatRequest, handlers: StreamChatHandlers): Promise<ChatResponse> {
  const context = buildContextPayload(input.contextFiles)
  const messages = buildChatMessages({ input, contextText: context.contextText })

  // 先发送上下文元信息
  handlers.onContext(context.contextMeta)
  // 再流式接收模型响应
  const replyText = await streamChatCompletion(messages, {
    onToken: handlers.onChunk,
  })

  // 最后整理代码建议和可见回复
  const suggestionPayload = buildSuggestionPayload(input.contextFiles, replyText)
  const visibleReply = buildVisibleReply(replyText, suggestionPayload)

  return chatResponseSchema.parse({
    reply: buildAssistantMessage(visibleReply),
    diffPreviews: suggestionPayload.diffPreviews,
    pendingSuggestions: suggestionPayload.pendingSuggestions,
    contextMeta: context.contextMeta,
  })
}
