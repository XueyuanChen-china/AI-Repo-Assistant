import type { RepoFile, RepoNode } from '@ai-repo-assistant/shared'

// 文件类型：File 对象或文件系统文件句柄
type FileLike = File | FileSystemFileHandle

// 仓库快照类型：包含根目录名称、节点树和打开的文件
type RepoSnapshot = {
  root: string
  nodes: RepoNode[]
  openFile: RepoFile | null
}

// 可变的目录节点类型：必须是目录类型且包含子节点数组
type MutableDirectoryNode = RepoNode & {
  type: 'directory'
  children: RepoNode[]
}

// 扩展的窗口类型：支持可选的文件夹选择器方法
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
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  const fallbackLanguage = extension ? extension.replace('.', '') : 'text'
  return languageByExtension[extension] ?? fallbackLanguage
}

function shouldIgnoreDirectory(name: string) {
  return ignoredDirectoryNames.has(name)
}

function shouldIgnoreFile(name: string) {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
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

// 确保目录路径存在，如果不存在则创建中间目录节点
function ensureDirectory(children: RepoNode[], pathSegments: string[]) {
  let currentChildren = children
  let currentPath = ''

  // 遍历路径中的每个段
  for (const segment of pathSegments) {
    // 构建当前的完整路径
    currentPath = currentPath ? `${currentPath}/${segment}` : segment

    // 查找或创建目录节点
    let nextNode = currentChildren.find((node) => node.type === 'directory' && node.name === segment) as MutableDirectoryNode | undefined

    // 如果目录不存在，创建新的目录节点
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

    // 移动到下一级目录的子节点列表
    currentChildren = nextNode.children
  }

  // 返回最后一级目录的子节点列表
  return currentChildren
}

function addFileNode(rootNodes: RepoNode[], relativePath: string, fileName: string) {
  // 将相对路径按 '/' 分割成路径段数组
  const pathSegments = relativePath.split('/')
  // 获取除最后一个元素外的所有路径段（目录路径）
  const directorySegments = pathSegments.slice(0, -1)
  // 获取文件名，如果路径段为空则使用提供的 fileName
  const leafName = pathSegments[pathSegments.length - 1] ?? fileName
  // 确保所有中间目录存在，返回文件所在的目录的子节点列表
  const siblingNodes = ensureDirectory(rootNodes, directorySegments)

  // 如果文件已经存在，则跳过添加
  if (siblingNodes.some((node) => node.type === 'file' && node.path === relativePath)) {
    return
  }

  // 创建文件节点并添加到父目录的子节点列表中
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
  // 对节点树进行排序，目录优先、按名称排序
  sortNodes(nodes)

  // 获取第一个文件路径，用于默认打开第一个文件
  const firstFilePath = getFirstFilePath(nodes)

  // 如果存在第一个文件，则读取其内容作为打开文件；否则保持 null
  const openFile = firstFilePath ? await readSelectedRepoFile(firstFilePath) : null

  // 返回仓库快照对象，包含根目录名称、节点树和默认打开文件
  return {
    root: rootName,
    nodes,
    openFile,
  } satisfies RepoSnapshot
}

async function buildSnapshotFromDirectoryHandle(directoryHandle: FileSystemDirectoryHandle) {
  // 清空之前选择的文件缓存
  selectedFiles.clear()

  // 递归遍历文件系统目录，构建节点树
  async function walkDirectory(handle: FileSystemDirectoryHandle, prefix = ''): Promise<RepoNode[]> {
    const nodes: RepoNode[] = []

    // 异步遍历目录中的所有条目
    for await (const [entryName, entryHandle] of handle.entries()) {
      // 处理子目录
      if (entryHandle.kind === 'directory') {
        // 跳过需要忽略的目录
        if (shouldIgnoreDirectory(entryName)) {
          continue
        }

        // 构建子目录的完整路径
        const nextPrefix = prefix ? `${prefix}/${entryName}` : entryName
        // 递归遍历子目录
        const children = await walkDirectory(entryHandle, nextPrefix)

        // 如果子目录为空，跳过该目录节点
        if (children.length === 0) {
          continue
        }

        // 添加目录节点到结果数组
        nodes.push({
          id: nextPrefix,
          name: entryName,
          path: nextPrefix,
          type: 'directory',
          children,
        })
        continue
      }

      // 跳过需要忽略的文件
      if (shouldIgnoreFile(entryName)) {
        continue
      }

      // 构建文件的完整路径
      const filePath = prefix ? `${prefix}/${entryName}` : entryName
      // 缓存文件句柄以便后续读取
      selectedFiles.set(filePath, entryHandle)
      // 添加文件节点到结果数组
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

  // 遍历根目录，获取完整的节点树
  const nodes = await walkDirectory(directoryHandle)
  // 构建并返回仓库快照
  return buildSnapshot(directoryHandle.name, nodes)
}

async function pickWithInputElement() {
  // 创建一个文件输入元素
  const input = document.createElement('input')
  input.type = 'file'
  // 允许一次选择多个文件
  input.multiple = true
  // 允许用户选择整个目录而不仅仅是文件
  input.setAttribute('webkitdirectory', '')
  input.setAttribute('directory', '')

  // 通过 Promise 等待用户选择文件夹，监听 change 事件获取文件列表
  const fileList = await new Promise<FileList | null>((resolve) => {
    input.addEventListener('change', () => resolve(input.files), { once: true })
    input.click()
  })

  // 如果未选择任何文件，抛出错误
  if (!fileList || fileList.length === 0) {
    throw new Error('No folder was selected.')
  }

  // 清空之前缓存的文件
  selectedFiles.clear()
  // 初始化根节点数组
  const rootNodes: RepoNode[] = []
  // 初始化根目录名称
  let rootName = 'Selected folder'

  // 遍历选中的所有文件
  for (const file of Array.from(fileList)) {
    // 获取文件相对于选中目录的路径
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    // 将路径按 '/' 分割成各个段，并过滤空字符串
    const parts = relativePath.split('/').filter(Boolean)

    // 如果路径段为空，跳过此文件
    if (parts.length === 0) {
      continue
    }

    // 设置根目录名称为选中目录的第一级目录名
    rootName = parts[0] ?? rootName
    // 获取相对于选中目录的相对路径（去掉第一级目录）
    const repoRelativePath = parts.slice(1).join('/')

    // 如果没有相对路径（文件在根目录），跳过此文件
    if (!repoRelativePath) {
      continue
    }

    // 检查文件所在的目录路径中是否包含需要忽略的目录名，如果有则跳过
    if (parts.slice(0, -1).some((segment) => shouldIgnoreDirectory(segment))) {
      continue
    }

    // 检查文件是否应该被忽略，如果是则跳过
    if (shouldIgnoreFile(file.name)) {
      continue
    }

    // 将文件缓存到 selectedFiles 映射中
    selectedFiles.set(repoRelativePath, file)
    // 将文件节点添加到根节点树中
    addFileNode(rootNodes, repoRelativePath, file.name)
  }

  // 构建并返回仓库快照
  return buildSnapshot(rootName, rootNodes)
}

// 导出函数：选择本地仓库
export async function pickLocalRepository() {
  // 将 window 类型扩展为支持目录选择器的类型
  const pickerWindow = window as PickerWindow

  // 如果浏览器支持原生的目录选择器 API，使用它
  if (typeof pickerWindow.showDirectoryPicker === 'function') {
    // 打开系统目录选择对话框
    const directoryHandle = await pickerWindow.showDirectoryPicker()
    // 从目录句柄构建仓库快照
    return buildSnapshotFromDirectoryHandle(directoryHandle)
  }

  // 否则使用文件输入元素方案（兼容旧浏览器）
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