import { applySuggestionRequestSchema, applySuggestionResponseSchema } from '@ai-repo-assistant/shared'
import type { FastifyInstance } from 'fastify'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { resolveRepoRoot } from '../services/repoServerFsService'

async function manualFindFile(currentDir: string, fileName: string, ignore: string[]): Promise<string[]> {
  // 初始化匹配结果数组，用于存储找到的所有匹配文件的完整路径
  const matches: string[] = []

  // 读取当前目录的所有条目，withFileTypes: true 返回 Dirent 对象以区分文件和文件夹
  const entries = await fs.readdir(currentDir, { withFileTypes: true })

  // 遍历当前目录中的每个条目
  for (const entry of entries) {
    // 检查该条目是否在忽略列表中，如果是则跳过
    if (ignore.some((item) => entry.name === item || entry.name.includes(item))) {
      continue
    }

    // 构建条目的完整路径
    const fullPath = path.join(currentDir, entry.name)

    // 如果当前条目是目录，则递归搜索子目录
    if (entry.isDirectory()) {
      // 递归调用 manualFindFile 搜索子目录中的匹配文件
      const nestedMatches = await manualFindFile(fullPath, fileName, ignore)
      // 将子目录中找到的所有匹配项添加到结果数组
      matches.push(...nestedMatches)
      continue
    }

    // 如果当前条目是文件，进行不区分大小写的文件名匹配
    if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      // 找到匹配的文件，将其完整路径添加到结果数组
      matches.push(fullPath)
    }
  }

  // 返回所有找到的匹配文件的完整路径数组
  return matches
}

async function findFileInRepo(repoRoot: string, targetPath: string): Promise<string | null> {
  try {
    const baseName = path.basename(targetPath)
    const files = await manualFindFile(repoRoot, baseName, ['node_modules', '.git', 'dist', 'build'])

    if (files.length === 0) {
      return null
    }

    if (files.length === 1) {
      return files[0]
    }

    const targetSegments = targetPath.replace(/\\/g, '/').split('/').reverse()
    let bestMatch = files[0]
    let maxMatchedSegments = 0

    for (const file of files) {
      const fileSegments = file.replace(/\\/g, '/').split('/').reverse()
      let matchedSegments = 0

      for (let index = 0; index < Math.min(targetSegments.length, fileSegments.length); index += 1) {
        if (targetSegments[index].toLowerCase() !== fileSegments[index].toLowerCase()) {
          break
        }

        matchedSegments += 1
      }

      if (matchedSegments > maxMatchedSegments) {
        maxMatchedSegments = matchedSegments
        bestMatch = file
      }
    }

    return bestMatch
  } catch (error) {
    console.error('Error while searching file in repo:', error)
    return null
  }
}

function ensureInsideRepo(repoRoot: string, targetAbsolutePath: string) {
  const relativePath = path.relative(repoRoot, targetAbsolutePath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('The target file is outside the current repository root.')
  }
}

async function validateAndResolvePath(repoRoot: string, targetPath: string): Promise<string> {
  const directPath = path.resolve(repoRoot, targetPath)
  ensureInsideRepo(repoRoot, directPath)

  const directExists = await fs.access(directPath).then(() => true).catch(() => false)
  if (directExists) {
    return directPath
  }

  const fuzzyPath = await findFileInRepo(repoRoot, targetPath)
  if (fuzzyPath) {
    ensureInsideRepo(repoRoot, fuzzyPath)
    return fuzzyPath
  }

  return directPath
}

export async function registerSuggestionRoutes(app: FastifyInstance) {
  app.post('/api/apply-suggestion', async (request, reply) => {
    try {
      const { repoRoot, targetPath, updatedContent } = applySuggestionRequestSchema.parse(request.body)

      // 审批应用修改时，必须绑定前端当前打开的仓库，而不是只靠服务端默认目录。
      const resolvedRepoRoot = await resolveRepoRoot(repoRoot)
      const targetAbsolutePath = await validateAndResolvePath(resolvedRepoRoot, targetPath)

      const exists = await fs.access(targetAbsolutePath).then(() => true).catch(() => false)
      if (!exists) {
        throw new Error(`File does not exist in the current repository: ${targetPath}`)
      }

      await fs.writeFile(targetAbsolutePath, updatedContent, 'utf8')
      const fileContent = await fs.readFile(targetAbsolutePath, 'utf8')
      const relativePath = path.relative(resolvedRepoRoot, targetAbsolutePath).replace(/\\/g, '/')

      return applySuggestionResponseSchema.parse({
        applied: true,
        file: {
          path: relativePath,
          language: path.extname(targetAbsolutePath).slice(1) || 'unknown',
          content: fileContent,
        },
        message: `Successfully applied changes to ${relativePath}`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply suggestion'

      if (error && (error as { name?: string }).name === 'ZodError') {
        return reply.status(400).send({ message })
      }

      return reply.status(500).send({ message })
    }
  })
}
