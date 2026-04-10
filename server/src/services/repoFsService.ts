// 这是旧版的服务入口文件。
// 现在服务端真正使用的实现已经迁移到 repoServerFsService.ts。
// 这里保留这个文件，是为了让你以后回顾时能知道：
// 1. 以前有一套“后端读取仓库”的方案
// 2. 现在它已经退居备用，不再是前端主流程
// 3. 如果旧代码还 import 这里，也不会立刻报错

export {
  getSuggestedRepoRoot,
  readRepoFile,
  readRepoTree,
  resolveRepoRoot,
} from './repoServerFsService'