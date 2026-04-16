import type { RepoFile, RepoNode } from '@ai-repo-assistant/shared'

type FileLike = File | FileSystemFileHandle

type RepoSnapshot = {
  root: string
  nodes: RepoNode[]
  openFile: RepoFile | null
}

type MutableDirectoryNode = {
  id: string
  name: string
  path: string
  type: 'directory'
  children: RepoNode[]
}

type PickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}

function createPickerAbortError() {
  const error = new Error('FOLDER_PICKER_ABORTED')
  error.name = 'AbortError'
  return error
}

export function isFolderPickerAbortError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  if (error.name === 'AbortError') {
    return true
  }

  return /aborted a request|no folder was selected/i.test(error.message)
}

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
const selectedFiles = new Map<string, FileLike>()

function normalizeRepoPath(filePath: string) {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function inferLanguage(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
  const fallbackLanguage = extension ? extension.replace('.', '') : 'text'
  return languageByExtension[extension] ?? fallbackLanguage
}

function shouldIgnoreDirectory(name: string) {
  return ignoredDirectoryNames.has(name)
}

function shouldIgnoreFile(name: string) {
  const dotIndex = name.lastIndexOf('.')
  const extension = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : ''
  return ignoredFileExtensions.has(extension)
}

function sortNodes(nodes: RepoNode[]) {
  nodes.sort((left, right) => {
    if (left.type === 'directory' && right.type !== 'directory') {
      return -1
    }

    if (left.type !== 'directory' && right.type === 'directory') {
      return 1
    }

    return left.name.localeCompare(right.name)
  })

  for (const node of nodes) {
    if (node.type === 'directory' && node.children) {
      sortNodes(node.children)
    }
  }
}

function getFirstFilePath(nodes: RepoNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'file') {
      return node.path
    }

    if (node.children?.length) {
      const nestedMatch = getFirstFilePath(node.children)
      if (nestedMatch) {
        return nestedMatch
      }
    }
  }

  return null
}

function ensureDirectory(children: RepoNode[], pathSegments: string[]) {
  let currentChildren = children
  let currentPath = ''

  for (const segment of pathSegments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment

    let nextNode = currentChildren.find((node) => node.type === 'directory' && node.name === segment) as MutableDirectoryNode | undefined

    if (!nextNode) {
      nextNode = {
        id: currentPath,
        name: segment,
        path: currentPath,
        type: 'directory',
        children: [],
      }
      currentChildren.push(nextNode)
    }

    currentChildren = nextNode.children
  }

  return currentChildren
}

function addFileNode(rootNodes: RepoNode[], relativePath: string, fileName: string) {
  const pathSegments = relativePath.split('/')
  const directorySegments = pathSegments.slice(0, -1)
  const leafName = pathSegments[pathSegments.length - 1] ?? fileName
  const siblingNodes = ensureDirectory(rootNodes, directorySegments)

  if (siblingNodes.some((node) => node.type === 'file' && node.path === relativePath)) {
    return
  }

  siblingNodes.push({
    id: relativePath,
    name: leafName,
    path: relativePath,
    type: 'file',
    language: inferLanguage(fileName),
  })
}

async function toFile(fileLike: FileLike) {
  if (fileLike instanceof File) {
    return fileLike
  }

  return fileLike.getFile()
}

function canWriteFile(fileLike: FileLike): fileLike is FileSystemFileHandle {
  return !(fileLike instanceof File) && typeof fileLike.createWritable === 'function'
}

function resolveStoredFilePath(requestedPath: string) {
  if (selectedFiles.has(requestedPath)) {
    return requestedPath
  }

  const normalizedTarget = normalizeRepoPath(requestedPath)
  const targetBaseName = normalizedTarget.split('/').pop()
  let suffixMatch: string | null = null
  const basenameMatches: string[] = []

  for (const storedPath of selectedFiles.keys()) {
    const normalizedStoredPath = normalizeRepoPath(storedPath)

    if (
      normalizedStoredPath.endsWith(normalizedTarget) ||
      normalizedTarget.endsWith(normalizedStoredPath)
    ) {
      suffixMatch = storedPath
      break
    }

    const storedBaseName = normalizedStoredPath.split('/').pop()
    if (targetBaseName && storedBaseName === targetBaseName) {
      basenameMatches.push(storedPath)
    }
  }

  if (suffixMatch) {
    return suffixMatch
  }

  if (basenameMatches.length === 1) {
    return basenameMatches[0]
  }

  return null
}

async function buildSnapshot(rootName: string, nodes: RepoNode[]) {
  sortNodes(nodes)
  const firstFilePath = getFirstFilePath(nodes)
  const openFile = firstFilePath ? await readSelectedRepoFile(firstFilePath) : null

  return {
    root: rootName,
    nodes,
    openFile,
  } satisfies RepoSnapshot
}

async function buildSnapshotFromDirectoryHandle(directoryHandle: FileSystemDirectoryHandle) {
  selectedFiles.clear()

  async function walkDirectory(handle: FileSystemDirectoryHandle, prefix = ''): Promise<RepoNode[]> {
    const nodes: RepoNode[] = []

    for await (const [entryName, entryHandle] of handle.entries()) {
      if (entryHandle.kind === 'directory') {
        const directoryEntry = entryHandle as FileSystemDirectoryHandle

        if (shouldIgnoreDirectory(entryName)) {
          continue
        }

        const nextPrefix = prefix ? `${prefix}/${entryName}` : entryName
        const children = await walkDirectory(directoryEntry, nextPrefix)

        if (children.length === 0) {
          continue
        }

        nodes.push({
          id: nextPrefix,
          name: entryName,
          path: nextPrefix,
          type: 'directory',
          children,
        })
        continue
      }

      if (shouldIgnoreFile(entryName)) {
        continue
      }

      const fileEntry = entryHandle as FileSystemFileHandle
      const filePath = prefix ? `${prefix}/${entryName}` : entryName
      selectedFiles.set(filePath, fileEntry)
      nodes.push({
        id: filePath,
        name: entryName,
        path: filePath,
        type: 'file',
        language: inferLanguage(entryName),
      })
    }

    return nodes
  }

  const nodes = await walkDirectory(directoryHandle)
  return buildSnapshot(directoryHandle.name, nodes)
}

async function pickWithInputElement() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.setAttribute('webkitdirectory', '')
  input.setAttribute('directory', '')

  const fileList = await new Promise<FileList | null>((resolve) => {
    input.addEventListener('change', () => resolve(input.files), { once: true })
    input.click()
  })

  if (!fileList || fileList.length === 0) {
    throw createPickerAbortError()
  }

  selectedFiles.clear()
  const rootNodes: RepoNode[] = []
  let rootName = 'Selected folder'

  for (const file of Array.from(fileList)) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    const parts = relativePath.split('/').filter(Boolean)

    if (parts.length === 0) {
      continue
    }

    rootName = parts[0] ?? rootName
    const repoRelativePath = parts.slice(1).join('/')

    if (!repoRelativePath) {
      continue
    }

    if (parts.slice(0, -1).some((segment) => shouldIgnoreDirectory(segment))) {
      continue
    }

    if (shouldIgnoreFile(file.name)) {
      continue
    }

    selectedFiles.set(repoRelativePath, file)
    addFileNode(rootNodes, repoRelativePath, file.name)
  }

  return buildSnapshot(rootName, rootNodes)
}

export async function pickLocalRepository() {
  const pickerWindow = window as PickerWindow

  if (typeof pickerWindow.showDirectoryPicker === 'function') {
    try {
      const directoryHandle = await pickerWindow.showDirectoryPicker()
      return buildSnapshotFromDirectoryHandle(directoryHandle)
    } catch (error) {
      if (isFolderPickerAbortError(error)) {
        throw createPickerAbortError()
      }

      throw error
    }
  }

  return pickWithInputElement()
}

export async function readSelectedRepoFile(filePath: string): Promise<RepoFile> {
  const resolvedPath = resolveStoredFilePath(filePath)
  const fileLike = resolvedPath ? selectedFiles.get(resolvedPath) : null

  if (!fileLike) {
    throw new Error(`The selected file could not be found in memory: ${filePath}`)
  }

  const file = await toFile(fileLike)

  if (file.size > maxFileSizeBytes) {
    throw new Error(`File is too large. The current version only previews files up to ${Math.floor(maxFileSizeBytes / 1024)}KB.`)
  }

  return {
    path: resolvedPath ?? filePath,
    language: inferLanguage(file.name),
    content: await file.text(),
  }
}

/**
 * 审批通过后，优先直接使用浏览器保存的文件句柄回写内容。
 * 这和当前“前端选择文件夹”的主流程是一致的，也能避免把虚拟仓库名误当成后端绝对路径。
 */
export async function writeSelectedRepoFile(filePath: string, nextContent: string): Promise<RepoFile> {
  // 根据请求的文件路径解析出实际存储的文件路径
  const resolvedPath = resolveStoredFilePath(filePath)
  // 从已选择的文件映射中获取对应的文件句柄或File对象
  const fileLike = resolvedPath ? selectedFiles.get(resolvedPath) : null

  // 如果文件不存在，抛出错误
  if (!fileLike) {
    throw new Error(`The selected file could not be found in memory: ${filePath}`)
  }

  // 检查文件句柄是否支持写入操作
  if (!canWriteFile(fileLike)) {
    throw new Error('The current folder selection mode is read-only. Please use the native folder picker to allow write access.')
  }

  // 创建一个可写流用于写入文件内容
  const writable = await fileLike.createWritable()
  // 将新内容写入文件
  await writable.write(nextContent)
  // 关闭写入流
  await writable.close()

  // 重新读取更新后的文件
  const updatedFile = await fileLike.getFile()

  // 返回包含更新文件信息的RepoFile对象
  return {
    path: resolvedPath ?? filePath,
    language: inferLanguage(updatedFile.name),
    content: await updatedFile.text(),
  }
}
