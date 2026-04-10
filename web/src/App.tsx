import { FolderPickerWorkspacePage } from './pages/FolderPickerWorkspacePage'

// App 目前很薄，只负责把真正的工作区页面挂进来。
// 后面如果要加路由、登录页、设置页，通常会从这里开始扩展。
export default function App() {
  return <FolderPickerWorkspacePage />
}