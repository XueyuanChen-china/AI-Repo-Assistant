import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { RepoFile, RepoNode } from '@ai-repo-assistant/shared'

const ignoredDirectoryNames = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  '.idea',
  '.vscode',
])

const ignoredFileExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.mp3',
  '.mov',
  '.avi',
  '.jar',
  '.class',
  '.pyc',
  '.lockb',
])

const languageByExtension: Record<string, string> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.jsx': 'jsx',
  '.mjs': 'js',
  '.cjs': 'js',
  '.json': 'json',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.md': 'markdown',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.sh': 'bash',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.xml': 'xml',
}

const maxFileSizeBytes = 256 * 1024
const serviceDirectory = fileURLToPath(new URL('.', import.meta.url))
const defaultRepoRoot = path.resolve(serviceDirectory, '..', '..', '..')

function toUnixPath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

function inferLanguage(fileName: string) {
  const extension = path.extname(fileName).toLowerCase()
  const fallbackLanguage = extension ? extension.replace('.', '') : 'text'
  return languageByExtension[extension] ?? fallbackLanguage
}

function shouldIgnoreDirectory(name: string) {
  return ignoredDirectoryNames.has(name)
}

function shouldIgnoreFile(name: string) {
  const extension = path.extname(name).toLowerCase()
  return ignoredFileExtensions.has(extension)
}

async function assertDirectoryExists(targetPath: string) {
  const stat = await fs.stat(targetPath)

  if (!stat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${targetPath}`)
  }
}

function ensureInsideRoot(rootPath: string, targetPath: string) {
  const relativePath = path.relative(rootPath, targetPath)
  const escapedRoot = relativePath.startsWith('..') || path.isAbsolute(relativePath)

  if (escapedRoot) {
    throw new Error('The requested file is outside the current repository root.')
  }
}

// 当前后端仓库服务的公开入口。
// 注意：这套能力已经不是前端主流程了，但服务端接口还在使用，所以保留干净版本集中维护。
export async function resolveRepoRoot(requestedRoot?: string) {
  const absoluteRoot = requestedRoot ? path.resolve(requestedRoot) : defaultRepoRoot
  await assertDirectoryExists(absoluteRoot)
  return absoluteRoot
}

async function buildNodeList(rootPath: string, currentPath: string): Promise<RepoNode[]> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true })
  const sortedEntries = [...entries].sort((left, right) => {
    if (left.isDirectory() && !right.isDirectory()) {
      return -1
    }

    if (!left.isDirectory() && right.isDirectory()) {
      return 1
    }

    return left.name.localeCompare(right.name)
  })

  const nodes: RepoNode[] = []

  for (const entry of sortedEntries) {
    const absoluteEntryPath = path.join(currentPath, entry.name)
    const relativeEntryPath = toUnixPath(path.relative(rootPath, absoluteEntryPath))

    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name)) {
        continue
      }

      const children = await buildNodeList(rootPath, absoluteEntryPath)

      if (children.length === 0) {
        continue
      }

      nodes.push({
        id: relativeEntryPath,
        name: entry.name,
        path: relativeEntryPath,
        type: 'directory',
        children,
      })
      continue
    }

    if (shouldIgnoreFile(entry.name)) {
      continue
    }

    nodes.push({
      id: relativeEntryPath,
      name: entry.name,
      path: relativeEntryPath,
      type: 'file',
      language: inferLanguage(entry.name),
    })
  }

  return nodes
}

export async function readRepoTree(rootPath: string) {
  return buildNodeList(rootPath, rootPath)
}

function looksBinary(buffer: Buffer) {
  const sampleLength = Math.min(buffer.length, 512)

  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true
    }
  }

  return false
}

export async function readRepoFile(rootPath: string, filePath: string): Promise<RepoFile> {
  const absoluteFilePath = path.resolve(rootPath, filePath)
  ensureInsideRoot(rootPath, absoluteFilePath)

  const stat = await fs.stat(absoluteFilePath)

  if (!stat.isFile()) {
    throw new Error(`Target path is not a file: ${filePath}`)
  }

  if (stat.size > maxFileSizeBytes) {
    throw new Error(`File is too large. The current version only previews files up to ${Math.floor(maxFileSizeBytes / 1024)}KB.`)
  }

  const fileBuffer = await fs.readFile(absoluteFilePath)

  if (looksBinary(fileBuffer)) {
    throw new Error('Binary files are not supported in the preview panel yet.')
  }

  return {
    path: toUnixPath(filePath),
    language: inferLanguage(absoluteFilePath),
    content: fileBuffer.toString('utf8'),
  }
}

export function getSuggestedRepoRoot() {
  return defaultRepoRoot
}