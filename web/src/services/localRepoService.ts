import type { RepoFile, RepoNode } from '@ai-repo-assistant/shared'

// 文件类型定义：可以是浏览器原生File对象或文件系统句柄
type FileLike = File | FileSystemFileHandle

// 仓库快照类型：包含根目录名、节点树和当前打开的文件
type RepoSnapshot = {
  root: string
  nodes: RepoNode[]
  openFile: RepoFile | null
}

// 可变目录节点类型：用于构建目录树时的中间类型
type MutableDirectoryNode = {
  id: string
  name: string
  path: string
  type: 'directory'
  children: RepoNode[]
}

// 扩展Window接口，添加showDirectoryPicker方法（用于原生文件夹选择器）
type PickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}

// 创建文件夹选择器中止错误
function createPickerAbortError() {
  const error = new Error('FOLDER_PICKER_ABORTED')
  error.name = 'AbortError'
  return error
}

// 判断是否为文件夹选择器中止错误
export function isFolderPickerAbortError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  // 检查错误名称或错误信息中的中止标记
  if (error.name === 'AbortError') {
    return true
  }

  return /aborted a request|no folder was selected/i.test(error.message)
}

// 需要忽略的目录名称集合（通常是构建产物、依赖项或IDE配置）
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

// 需要忽略的文件扩展名集合（二进制文件、资源文件等）
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

// 文件扩展名到编程语言的映射表
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

// 单个文件最大大小限制（256KB）
const maxFileSizeBytes = 256 * 1024
// 已选择的文件映射表：path -> File或FileSystemFileHandle
const selectedFiles = new Map<string, FileLike>()

// 规范化仓库路径：统一分隔符和大小写
function normalizeRepoPath(filePath: string) {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

// 根据文件名推断编程语言
function inferLanguage(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
  // 如果映射表中没有，则使用扩展名本身作为fallback
  const fallbackLanguage = extension ? extension.replace('.', '') : 'text'
  return languageByExtension[extension] ?? fallbackLanguage
}

// 判断是否应该忽略该目录
function shouldIgnoreDirectory(name: string) {
  return ignoredDirectoryNames.has(name)
}

// 判断是否应该忽略该文件
function shouldIgnoreFile(name: string) {
  const dotIndex = name.lastIndexOf('.')
  const extension = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : ''
  return ignoredFileExtensions.has(extension)
}

// 对节点进行排序：目录优先，同类型按名称字典序排序，递归整个树
function sortNodes(nodes: RepoNode[]) {
  nodes.sort((left, right) => {
    // 目录节点排在文件节点之前
    if (left.type === 'directory' && right.type !== 'directory') {
      return -1
    }

    if (left.type !== 'directory' && right.type === 'directory') {
      return 1
    }

    // 同类型则按名称排序
    return left.name.localeCompare(right.name)
  })

  // 递归排序子目录
  for (const node of nodes) {
    if (node.type === 'directory' && node.children) {
      sortNodes(node.children)
    }
  }
}

// 获取第一个文件的路径（用于默认打开）
function getFirstFilePath(nodes: RepoNode[]): string | null {
  for (const node of nodes) {
    // 找到文件节点则返回其路径
    if (node.type === 'file') {
      return node.path
    }

    // 如果是目录，递归查找子目录
    if (node.children?.length) {
      const nestedMatch = getFirstFilePath(node.children)
      if (nestedMatch) {
        return nestedMatch
      }
    }
  }

  return null
}

// 确保目录链路存在，不存在则创建中间目录
function ensureDirectory(children: RepoNode[], pathSegments: string[]) {
  let currentChildren = children
  let currentPath = ''

  // 遍历每个路径段，确保对应的目录节点存在
  for (const segment of pathSegments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment

    // 查找或创建目录节点
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

// 向根节点树中添加文件节点
function addFileNode(rootNodes: RepoNode[], relativePath: string, fileName: string) {
  // 将路径分解为各个段
  const pathSegments = relativePath.split('/')
  // 除去文件名的目录段
  const directorySegments = pathSegments.slice(0, -1)
  // 获取文件名（最后一个路径段）
  const leafName = pathSegments[pathSegments.length - 1] ?? fileName
  // 确保目录链路存在
  const siblingNodes = ensureDirectory(rootNodes, directorySegments)

  // 避免重复添加相同路径的文件
  if (siblingNodes.some((node) => node.type === 'file' && node.path === relativePath)) {
    return
  }

  // 创建并添加文件节点
  siblingNodes.push({
    id: relativePath,
    name: leafName,
    path: relativePath,
    type: 'file',
    language: inferLanguage(fileName),
  })
}

// 将文件类型统一转换为File对象
async function toFile(fileLike: FileLike) {
  if (fileLike instanceof File) {
    return fileLike
  }

  // FileSystemFileHandle需要调用getFile()方法获取File对象
  return fileLike.getFile()
}

// 类型守卫：判断是否可以写入文件（FileSystemFileHandle支持写入，File不支持）
function canWriteFile(fileLike: FileLike): fileLike is FileSystemFileHandle {
  return !(fileLike instanceof File) && typeof fileLike.createWritable === 'function'
}

// 根据请求的文件路径解析出实际在selectedFiles中存储的路径
function resolveStoredFilePath(requestedPath: string) {
  // 直接命中则返回
  if (selectedFiles.has(requestedPath)) {
    return requestedPath
  }

  // 规范化目标路径进行模糊匹配
  const normalizedTarget = normalizeRepoPath(requestedPath)
  const targetBaseName = normalizedTarget.split('/').pop()
  let suffixMatch: string | null = null
  const basenameMatches: string[] = []

  // 遍历已存储的所有文件进行匹配
  for (const storedPath of selectedFiles.keys()) {
    const normalizedStoredPath = normalizeRepoPath(storedPath)

    // 优先匹配路径后缀或前缀关系
    if (
      normalizedStoredPath.endsWith(normalizedTarget) ||
      normalizedTarget.endsWith(normalizedStoredPath)
    ) {
      suffixMatch = storedPath
      break
    }

    // 次级匹配：文件名相同
    const storedBaseName = normalizedStoredPath.split('/').pop()
    if (targetBaseName && storedBaseName === targetBaseName) {
      basenameMatches.push(storedPath)
    }
  }

  if (suffixMatch) {
    return suffixMatch
  }

  // 只有一个文件名匹配则返回
  if (basenameMatches.length === 1) {
    return basenameMatches[0]
  }

  return null
}

// 构建仓库快照：排序节点、获取首个文件内容
async function buildSnapshot(rootName: string, nodes: RepoNode[]) {
  // 对节点树进行排序
  sortNodes(nodes)
  // 获取第一个文件的路径并读取其内容
  const firstFilePath = getFirstFilePath(nodes)
  const openFile = firstFilePath ? await readSelectedRepoFile(firstFilePath) : null

  return {
    root: rootName,
    nodes,
    openFile,
  } satisfies RepoSnapshot
}

// 从文件系统目录句柄构建仓库快照
async function buildSnapshotFromDirectoryHandle(directoryHandle: FileSystemDirectoryHandle) {
  // 清空已选择的文件映射
  selectedFiles.clear()

  // 递归遍历目录树，构建节点结构
  async function walkDirectory(handle: FileSystemDirectoryHandle, prefix = ''): Promise<RepoNode[]> {
    const nodes: RepoNode[] = []

    // 遍历目录中的所有条目
    for await (const [entryName, entryHandle] of handle.entries()) {
      if (entryHandle.kind === 'directory') {
        const directoryEntry = entryHandle as FileSystemDirectoryHandle

        // 跳过被忽略的目录
        if (shouldIgnoreDirectory(entryName)) {
          continue
        }

        // 构造完整的目录路径
        const nextPrefix = prefix ? `${prefix}/${entryName}` : entryName
        // 递归走目录
        const children = await walkDirectory(directoryEntry, nextPrefix)

        // 跳过空目录
        if (children.length === 0) {
          continue
        }

        // 添加目录节点
        nodes.push({
          id: nextPrefix,
          name: entryName,
          path: nextPrefix,
          type: 'directory',
          children,
        })
        continue
      }

      // 跳过被忽略的文件
      if (shouldIgnoreFile(entryName)) {
        continue
      }

      // 处理文件条目
      const fileEntry = entryHandle as FileSystemFileHandle
      const filePath = prefix ? `${prefix}/${entryName}` : entryName
      // 将文件句柄存储到映射表
      selectedFiles.set(filePath, fileEntry)
      // 添加文件节点
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

// 使用input元素进行文件夹选择（fallback方案）
async function pickWithInputElement() {
  // 创建隐藏的file input，设置为目录选择模式
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.setAttribute('webkitdirectory', '')
  input.setAttribute('directory', '')

  // 监听变更事件并获取文件列表
  const fileList = await new Promise<FileList | null>((resolve) => {
    input.addEventListener('change', () => resolve(input.files), { once: true })
    input.click()
  })

  // 用户取消选择时抛出中止错误
  if (!fileList || fileList.length === 0) {
    throw createPickerAbortError()
  }

  // 清空已选择的文件映射
  selectedFiles.clear()
  const rootNodes: RepoNode[] = []
  let rootName = 'Selected folder'

  // 处理选中的文件列表
  for (const file of Array.from(fileList)) {
    // 获取相对路径（webkitRelativePath格式为"folder/file.txt"）
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    const parts = relativePath.split('/').filter(Boolean)

    if (parts.length === 0) {
      continue
    }

    // 第一个部分是根目录名
    rootName = parts[0] ?? rootName
    // 后续部分是相对于根目录的路径
    const repoRelativePath = parts.slice(1).join('/')

    // 跳过根目录本身的项
    if (!repoRelativePath) {
      continue
    }

    // 跳过包含被忽略目录的文件
    if (parts.slice(0, -1).some((segment) => shouldIgnoreDirectory(segment))) {
      continue
    }

    // 跳过被忽略的文件
    if (shouldIgnoreFile(file.name)) {
      continue
    }

    // 存储文件并添加到节点树
    selectedFiles.set(repoRelativePath, file)
    addFileNode(rootNodes, repoRelativePath, file.name)
  }

  return buildSnapshot(rootName, rootNodes)
}

// 导出：打开本地仓库选择对话框
export async function pickLocalRepository() {
  const pickerWindow = window as PickerWindow

  // 优先使用原生的showDirectoryPicker API
  if (typeof pickerWindow.showDirectoryPicker === 'function') {
    try {
      const directoryHandle = await pickerWindow.showDirectoryPicker()
      return buildSnapshotFromDirectoryHandle(directoryHandle)
    } catch (error) {
      // 用户取消时转换为统一的中止错误
      if (isFolderPickerAbortError(error)) {
        throw createPickerAbortError()
      }

      throw error
    }
  }

  // Fallback：使用input元素方案
  return pickWithInputElement()
}

// 导出：读取已选择仓库中的文件内容
export async function readSelectedRepoFile(filePath: string): Promise<RepoFile> {
  // 解析实际存储的文件路径
  const resolvedPath = resolveStoredFilePath(filePath)
  const fileLike = resolvedPath ? selectedFiles.get(resolvedPath) : null

  // 文件不存在则抛出错误
  if (!fileLike) {
    throw new Error(`The selected file could not be found in memory: ${filePath}`)
  }

  // 转换为File对象
  const file = await toFile(fileLike)

  // 检查文件大小限制
  if (file.size > maxFileSizeBytes) {
    throw new Error(`File is too large. The current version only previews files up to ${Math.floor(maxFileSizeBytes / 1024)}KB.`)
  }

  // 返回文件信息和内容
  return {
    path: resolvedPath ?? filePath,
    language: inferLanguage(file.name),
    content: await file.text(),
  }
}

/**
 * 审批通过后，优先直接使用浏览器保存的文件句柄回写内容。
 * 这和当前"前端选择文件夹"的主流程是一致的，也能避免把虚拟仓库名误当成后端绝对路径。
 */
// 导出：向已选择仓库中的文件写入内容
export async function writeSelectedRepoFile(filePath: string, nextContent: string): Promise<RepoFile> {
  // 根据请求的文件路径解析出实际存储的文件路径
  const resolvedPath = resolveStoredFilePath(filePath)
  // 从已选择的文件映射中获取对应的文件句柄或File对象
  const fileLike = resolvedPath ? selectedFiles.get(resolvedPath) : null

  // 如果文件不存在，抛出错误
  if (!fileLike) {
    throw new Error(`The selected file could not be found in memory: ${filePath}`)
  }

  // 检查文件句柄是否支持写入操作（File对象不支持写入）
  if (!canWriteFile(fileLike)) {
    throw new Error('The current folder selection mode is read-only. Please use the native folder picker to allow write access.')
  }

  // 创建一个可写流用于写入文件内容
  const writable = await fileLike.createWritable()
  // 将新内容写入文件
  await writable.write(nextContent)
  // 关闭写入流，文件更新完成
  await writable.close()

  // 重新读取更新后的文件元数据和内容
  const updatedFile = await fileLike.getFile()

  // 返回包含更新文件信息的RepoFile对象
  return {
    path: resolvedPath ?? filePath,
    language: inferLanguage(updatedFile.name),
    content: await updatedFile.text(),
  }
}
