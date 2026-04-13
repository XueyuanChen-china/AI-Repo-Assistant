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

// The web app now sends the actual selected file contents to the server,
// because the current repository workflow is browser-driven instead of server-driven.
export const selectedContextFileSchema = z.object({
  path: z.string(),
  language: z.string(),
  content: z.string(),
})

/**
 * 聊天上下文元数据的 Zod 验证模式
 * 
 * @typedef {Object} ChatContextMeta
 * @property {string[]} usedContextPaths - 已使用的上下文文件路径数组
 * @property {string[]} truncatedPaths - 被截断的文件路径数组
 * @property {number} totalCharacters - 上下文中的总字符数（非负整数）
 * 
 * @remarks
 * 用于验证和类型化聊天请求中的上下文元数据信息
 */
export const chatContextMetaSchema = z.object({
  usedContextPaths: z.array(z.string()),
  truncatedPaths: z.array(z.string()),
  totalCharacters: z.number().int().nonnegative(),
})

export const chatRequestSchema = z.object({
  message: z.string().min(1),
  selectedPaths: z.array(z.string()),
  contextFiles: z.array(selectedContextFileSchema).max(5).default([]),
})

export const chatResponseSchema = z.object({
  reply: workspaceMessageSchema,
  diffPreview: diffPreviewSchema.nullish(),
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
  diffPreview: diffPreviewSchema.nullish(),
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
export type RepoTreeQuery = z.infer<typeof repoTreeQuerySchema>
export type RepoFileQuery = z.infer<typeof repoFileQuerySchema>
export type RepoTreeResponse = z.infer<typeof repoTreeResponseSchema>
export type RepoFileResponse = z.infer<typeof repoFileResponseSchema>
export type HealthResponse = z.infer<typeof healthResponseSchema>
export type SelectedContextFile = z.infer<typeof selectedContextFileSchema>
export type ChatContextMeta = z.infer<typeof chatContextMetaSchema>
export type ChatRequest = z.infer<typeof chatRequestSchema>
export type ChatResponse = z.infer<typeof chatResponseSchema>
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>

export type InspectorMode = 'code' | 'diff'