import { z } from 'zod'

export type RepoNode = {
  id: string
  name: string
  path: string
  type: 'file' | 'directory'
  language?: string
  children?: RepoNode[]
}

export const repoNodeSchema: z.ZodType<RepoNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    type: z.enum(['file', 'directory']),
    language: z.string().optional(),
    children: z.array(repoNodeSchema).optional(),
  }),
)

export const repoFileSchema = z.object({
  path: z.string(),
  language: z.string(),
  content: z.string(),
})

export const workspaceMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string(),
})

export const diffPreviewSchema = z.object({
  path: z.string(),
  title: z.string(),
  summary: z.string(),
  before: z.string(),
  after: z.string(),
})

export const repoTreeQuerySchema = z.object({
  root: z.string().trim().optional(),
})

export const repoFileQuerySchema = z.object({
  root: z.string().min(1),
  path: z.string().min(1),
})

export const repoTreeResponseSchema = z.object({
  root: z.string(),
  nodes: z.array(repoNodeSchema),
})

export const repoFileResponseSchema = z.object({
  file: repoFileSchema,
})

export const healthResponseSchema = z.object({
  status: z.string(),
  mode: z.string(),
  timestamp: z.string(),
  suggestedRoot: z.string(),
})

// 浏览器会把用户选中的文件内容一并传给后端，所以这里要保留完整文件内容。
export const selectedContextFileSchema = z.object({
  path: z.string(),
  language: z.string(),
  content: z.string(),
})

export const chatContextMetaSchema = z.object({
  usedContextPaths: z.array(z.string()),
  truncatedPaths: z.array(z.string()),
  totalCharacters: z.number().int().nonnegative(),
})

// 单条待审批建议，始终只对应一个目标文件。
export const pendingSuggestionSchema = z.object({
  targetPath: z.string(),
  updatedContent: z.string(),
  summary: z.string(),
})

export const chatRequestSchema = z.object({
  message: z.string().min(1),
  selectedPaths: z.array(z.string()),
  contextFiles: z.array(selectedContextFileSchema).max(5).default([]),
  historyMessages: z.array(workspaceMessageSchema).max(6).default([]),
})

export const applySuggestionRequestSchema = z.object({
  repoRoot: z.string().min(1),
  targetPath: z.string(),
  updatedContent: z.string(),
})

export const applySuggestionResponseSchema = z.object({
  applied: z.boolean(),
  file: repoFileSchema,
  message: z.string(),
})

// Day 4 扩展成“多文件建议列表”，所以这里统一返回数组。
export const chatResponseSchema = z.object({
  reply: workspaceMessageSchema,
  diffPreviews: z.array(diffPreviewSchema).default([]),
  pendingSuggestions: z.array(pendingSuggestionSchema).default([]),
  contextMeta: chatContextMetaSchema,
})

export const chatStreamContextEventSchema = z.object({
  type: z.literal('context'),
  contextMeta: chatContextMetaSchema,
})

export const chatStreamChunkEventSchema = z.object({
  type: z.literal('chunk'),
  content: z.string(),
})

export const chatStreamDoneEventSchema = z.object({
  type: z.literal('done'),
  reply: workspaceMessageSchema,
  diffPreviews: z.array(diffPreviewSchema).default([]),
  pendingSuggestions: z.array(pendingSuggestionSchema).default([]),
  contextMeta: chatContextMetaSchema,
})

export const chatStreamErrorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
})

export const chatStreamEventSchema = z.discriminatedUnion('type', [
  chatStreamContextEventSchema,
  chatStreamChunkEventSchema,
  chatStreamDoneEventSchema,
  chatStreamErrorEventSchema,
])

export type RepoFile = z.infer<typeof repoFileSchema>
export type WorkspaceMessage = z.infer<typeof workspaceMessageSchema>
export type DiffPreview = z.infer<typeof diffPreviewSchema>
export type PendingSuggestion = z.infer<typeof pendingSuggestionSchema>
export type RepoTreeQuery = z.infer<typeof repoTreeQuerySchema>
export type RepoFileQuery = z.infer<typeof repoFileQuerySchema>
export type RepoTreeResponse = z.infer<typeof repoTreeResponseSchema>
export type RepoFileResponse = z.infer<typeof repoFileResponseSchema>
export type HealthResponse = z.infer<typeof healthResponseSchema>
export type SelectedContextFile = z.infer<typeof selectedContextFileSchema>
export type ChatContextMeta = z.infer<typeof chatContextMetaSchema>
export type ChatRequest = z.infer<typeof chatRequestSchema>
export type ChatResponse = z.infer<typeof chatResponseSchema>
export type ApplySuggestionRequest = z.infer<typeof applySuggestionRequestSchema>
export type ApplySuggestionResponse = z.infer<typeof applySuggestionResponseSchema>
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>

export type InspectorMode = 'code' | 'diff'
