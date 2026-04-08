import { z } from 'zod'

// shared 包只放“前后端都要认识”的数据结构。
// 这样前端、后端都用同一套类型和校验规则，接口更不容易对不上。

// RepoNode 描述左侧文件树里的一个节点。
// 它既可以是目录，也可以是文件；目录下可以继续套 children。
export type RepoNode = {
  id: string
  name: string
  path: string
  type: 'file' | 'directory'
  language?: string
  children?: RepoNode[]
}

// zod schema 的作用是“运行时校验”。
// TypeScript 只能在写代码时帮你检查类型，真正收到接口数据时还需要 schema 再兜一层。
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


// 单个文件的内容，用在右侧代码预览面板。
export const repoFileSchema = z.object({
  path: z.string(),
  language: z.string(),
  content: z.string(),
})

// 聊天消息结构，用在中间对话区。
export const workspaceMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string(),
})

// diffPreview 是“修改建议预览”，不是实际落盘结果。
// Day 1 先只做到让用户看前后差异，后面再接真实写文件。
export const diffPreviewSchema = z.object({
  path: z.string(),
  title: z.string(),
  summary: z.string(),
  before: z.string(),
  after: z.string(),
})

// 下面这些 schema 对应后端接口的返回值 / 请求体。
export const repoTreeResponseSchema = z.object({
  root: z.string(),
  nodes: z.array(repoNodeSchema),
})

export const repoFileResponseSchema = z.object({
  file: repoFileSchema,
})

export const chatRequestSchema = z.object({
  message: z.string().min(1),
  selectedPaths: z.array(z.string()),
})

export const chatResponseSchema = z.object({
  reply: workspaceMessageSchema,
  diffPreview: diffPreviewSchema.nullish(),
})

// 这些 type 是从 schema 反推出的 TS 类型。
// 好处是“类型定义”和“运行时校验”只维护一份，不容易写两套后不一致。
export type RepoFile = z.infer<typeof repoFileSchema>
export type WorkspaceMessage = z.infer<typeof workspaceMessageSchema>
export type DiffPreview = z.infer<typeof diffPreviewSchema>
export type RepoTreeResponse = z.infer<typeof repoTreeResponseSchema>
export type RepoFileResponse = z.infer<typeof repoFileResponseSchema>
export type ChatRequest = z.infer<typeof chatRequestSchema>
export type ChatResponse = z.infer<typeof chatResponseSchema>

// 右侧检查面板目前有两个模式：看代码，或者看 diff。
export type InspectorMode = 'code' | 'diff'
