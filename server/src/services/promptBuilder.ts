import type { ChatRequest } from '@ai-repo-assistant/shared'

type PromptBuilderInput = {
  input: ChatRequest
  contextText: string
}

type ChatModelMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const systemPrompt = [
  'You are AI Repo Assistant, a repository-aware coding helper.',
  'Answer using the provided file context when possible.',
  'If the provided context is insufficient, clearly say what is missing instead of inventing details.',
  'When you suggest code changes, mention the file path and explain the change at a high level.',
  'Keep the answer concise, practical, and easy to follow.',
].join('\n')

/**
 * 构建聊天消息数组
 * @param input - 提示词构建器输入参数
 * @param input.input - 包含用户消息和选中文件路径的输入对象
 * @param input.contextText - 仓库上下文文本
 * @returns 返回包含系统提示和用户提示的聊天消息数组
 * 
 * @example
 * ```typescript
 * const messages = buildChatMessages({
 *   input: {
 *     message: '帮我优化这段代码',
 *     selectedPaths: ['src/utils.ts', 'src/helpers.ts']
 *   },
 *   contextText: '项目使用 TypeScript 和 React'
 * });
 * ```
 */
export function buildChatMessages({ input, contextText }: PromptBuilderInput): ChatModelMessage[] {
  const selectedPathText = input.selectedPaths.length > 0 ? input.selectedPaths.join('\n') : 'NONE'

  const userPrompt = [
    'USER REQUEST:',
    input.message,
    '',
    'SELECTED FILE PATHS:',
    selectedPathText,
    '',
    'REPOSITORY CONTEXT:',
    contextText,
  ].join('\n')

  return [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: userPrompt,
    },
  ]
}

export type { ChatModelMessage }