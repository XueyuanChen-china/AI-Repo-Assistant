import type { SelectedContextFile, ChatContextMeta } from '@ai-repo-assistant/shared'

// 最多选择5个上下文文件
const MAX_CONTEXT_FILES = 5
// 上下文总字符数限制
const MAX_TOTAL_CONTEXT_CHARS = 12000
// 单个文件最大字符数限制
const MAX_SINGLE_FILE_CHARS = 3600

// 构建的上下文类型
type BuiltContext = {
  contextText: string
  contextMeta: ChatContextMeta
}

/**
 * 将内容修剪到指定的字符限制
 * @param content - 原始内容
 * @param limit - 字符限制
 * @returns 修剪后的内容和是否被截断的标志
 */
function trimContentToBudget(content: string, limit: number) {
  if (content.length <= limit) {
    return {
      content,
      truncated: false,
    }
  }

  return {
    content: `${content.slice(0, limit)}\n\n...[truncated]`,
    truncated: true,
  }
}

/**
 * 构建上下文负载
 * @param contextFiles - 选定的上下文文件列表
 * @returns 包含上下文文本和元数据的对象
 */
export function buildContextPayload(contextFiles: SelectedContextFile[]): BuiltContext {
  // 限制文件数量
  const limitedFiles = contextFiles.slice(0, MAX_CONTEXT_FILES)
  // 已使用的上下文文件路径
  const usedContextPaths: string[] = []
  // 被截断的文件路径
  const truncatedPaths: string[] = []
  // 格式化的文件内容段落
  const sections: string[] = []
  // 剩余的字符预算
  let remainingBudget = MAX_TOTAL_CONTEXT_CHARS
  // 已使用的总字符数
  let totalCharacters = 0

  // 遍历限制后的文件列表
  for (const file of limitedFiles) {
    // 如果没有剩余预算，跳过后续文件
    if (remainingBudget <= 0) {
      truncatedPaths.push(file.path)
      continue
    }

    // 计算该文件的字符限制
    const nextLimit = Math.min(MAX_SINGLE_FILE_CHARS, remainingBudget)
    // 修剪文件内容
    const result = trimContentToBudget(file.content, nextLimit)

    // 记录已使用的文件路径
    usedContextPaths.push(file.path)
    // 更新总字符数和剩余预算
    totalCharacters += result.content.length
    remainingBudget -= result.content.length

    // 如果内容被截断，记录到截断列表
    if (result.truncated) {
      truncatedPaths.push(file.path)
    }

    // 格式化并添加文件内容段落
    sections.push([
      `FILE: ${file.path}`,
      `LANGUAGE: ${file.language}`,
      'CONTENT START',
      result.content,
      'CONTENT END',
    ].join('\n'))
  }

  // 返回上下文和元数据
  return {
    contextText: sections.length > 0 ? sections.join('\n\n') : 'NO_CONTEXT_FILES_SELECTED',
    contextMeta: {
      usedContextPaths,
      truncatedPaths,
      totalCharacters,
    },
  }
}