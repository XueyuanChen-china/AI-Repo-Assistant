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
  'When you suggest code changes, you MAY provide one or more structured suggestion blocks.',
  'Each block must describe exactly one file.',
  '',
  'CODE_SUGGESTION_START',
  'Target Path: [file path]',
  'Summary: [brief description of changes]',
  '```[language]',
  '[updated full file content]',
  '```',
  'CODE_SUGGESTION_END',
  '',
  'Rules for suggestions:',
  '1. Prefer 1 suggestion, but you may return up to 3 files when the request clearly requires multiple files.',
  '2. The Target Path MUST match one of the provided file paths.',
  '3. The content inside the code block MUST be the FULL updated file content, not a partial diff.',
  '4. Do not invent a new file name when the user is asking to modify an existing file.',
  '5. If you cannot provide the complete final file content, do not use the CODE_SUGGESTION format.',
  '6. Outside the CODE_SUGGESTION blocks, provide a short explanation of what changed.',
  '7. When the user asks for editable code changes, prefer CODE_SUGGESTION blocks over plain markdown code fences.',
  '8. Do not output unlabeled raw code blocks when the user expects an editable suggestion.',
  '',
  'Example for multi-file edits:',
  'CODE_SUGGESTION_START',
  'Target Path: test/mathHelpers.ts',
  'Summary: Add Chinese comments',
  '```ts',
  '// full updated file content here',
  '```',
  'CODE_SUGGESTION_END',
  'CODE_SUGGESTION_START',
  'Target Path: test/reportService.ts',
  'Summary: Add Chinese comments',
  '```ts',
  '// full updated file content here',
  '```',
  'CODE_SUGGESTION_END',
  '',
  'Keep the answer concise, practical, and easy to follow.',
].join('\n')


export function buildChatMessages({ input, contextText }: PromptBuilderInput): ChatModelMessage[] {
  // 构建选中文件路径的文本内容
  const selectedPathText = input.selectedPaths.length > 0 ? input.selectedPaths.join('\n') : 'NONE'

  // 组装用户提示词，包含请求、选中路径和仓库上下文
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

  // 初始化消息数组，添加系统提示词
  const messages: ChatModelMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
  ]

  // 获取历史消息（最多6条），并添加到消息数组
  const historyMessages = input.historyMessages?.slice(-6) ?? []
  for (const message of historyMessages) {
    messages.push({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: message.content,
    })
  }

  // 添加当前用户消息
  messages.push({
    role: 'user',
    content: userPrompt,
  })

  return messages
}

export type { ChatModelMessage }
