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
    throw new Error('No folder was selected.')
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
    const directoryHandle = await pickerWindow.showDirectoryPicker()
    return buildSnapshotFromDirectoryHandle(directoryHandle)
  }

  return pickWithInputElement()
}

// 导出函数：读取选中的仓库文件
export async function readSelectedRepoFile(filePath: string): Promise<RepoFile> {
  // 从缓存的文件映射中获取文件
  const fileLike = selectedFiles.get(filePath)

  // 如果文件不存在于缓存中，抛出错误
  if (!fileLike) {
    throw new Error(`The selected file could not be found in memory: ${filePath}`)
  }

  // 将文件句柄转换为 File 对象
  const file = await toFile(fileLike)

  // 检查文件大小是否超过限制
  if (file.size > maxFileSizeBytes) {
    throw new Error(`File is too large. The current version only previews files up to ${Math.floor(maxFileSizeBytes / 1024)}KB.`)
  }

  // 返回包含文件路径、编程语言和内容的对象
  return {
    path: filePath,
    language: inferLanguage(file.name),
    content: await file.text(),
  }
}