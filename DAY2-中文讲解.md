# DAY2 中文讲解

这份文档是 Day 2 的简短回顾版，目标不是讲细节，而是方便以后快速想起来：这一阶段到底改了什么、现在主流程走哪一套。

---

## Day 2 做了什么

Day 2 的核心目标是：

- 不再让用户手动输入仓库路径
- 改成像 VSCode 一样，直接选择本地文件夹
- 选择完成后，在前端生成文件树并读取文件内容

也就是说，现在的主流程已经从：

- 前端输入路径
- 后端读取仓库

变成了：

- 前端选择文件夹
- 前端 service 生成文件树
- 前端按路径读取选中的文件

---

## 现在主流程是哪一套

当前主流程是：

1. 页面打开后进入 [FolderPickerWorkspacePage.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/pages/FolderPickerWorkspacePage.tsx)
2. 用户点击“打开文件夹”
3. 前端调用 [localRepoService.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/services/localRepoService.ts)
4. `localRepoService` 调起系统文件夹选择器
5. 前端递归生成 `RepoNode[]` 文件树
6. 文件树放进 Zustand store
7. 用户点击文件时，再由 `localRepoService` 读取对应文件内容
8. 右侧查看器显示代码，聊天区继续走现有 mock / API 流程

一句话概括：

`现在仓库读取这条链路，主角已经变成前端 service。`

---

## 哪几个文件最重要

### 1. `web/src/pages/FolderPickerWorkspacePage.tsx`

这是当前工作区页面入口。

它负责：

- 串起左中右三栏
- 处理“打开文件夹”动作
- 调 `localRepoService`
- 把结果写进 store
- 处理聊天和查看器联动

你可以把它理解成：

`页面编排层`

---

### 2. `web/src/services/localRepoService.ts`

这是 Day 2 最关键的新文件。

它负责：

- 调起文件夹选择器
- 遍历文件夹
- 过滤无关目录和文件
- 生成文件树结构
- 按路径读取文件内容

你可以把它理解成：

`前端版仓库读取服务`

---

### 3. `web/src/components/RepositoryPickerPanel.tsx`

这是左侧仓库面板。

它负责：

- 显示打开文件夹按钮
- 渲染文件树
- 打开文件
- 勾选上下文文件

你可以把它理解成：

`左侧仓库 UI`

---

## 旧方案和新方案的区别

### 旧方案

旧方案主要是：

- 输入仓库路径
- 请求后端接口
- 后端读取真实文件系统
- 前端拿结果展示

对应的旧文件主要有：

- [WorkspacePageExpired.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/pages/WorkspacePageExpired.tsx)
- 旧版文件树组件
- 服务端仓库读取能力，比如 `repoFsService.ts`

### 新方案

新方案主要是：

- 用户直接选文件夹
- 前端 service 构建文件树
- 前端按路径读取已选择的文件

对应的核心文件是：

- [FolderPickerWorkspacePage.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/pages/FolderPickerWorkspacePage.tsx)
- [localRepoService.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/services/localRepoService.ts)
- [RepositoryPickerPanel.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/components/RepositoryPickerPanel.tsx)

---

## 现在后端那套是不是废了

更准确地说：

- `后端读取仓库` 这条链路现在**不是主流程**了
- 但它还可以保留成备用方案
- 当前正在使用的是“前端选择文件夹 + 前端 service 生成文件树”这套实现

所以你以后回顾时记住这句话就够了：

`Day 2 之后，仓库加载主流程已经切到前端 service，后端读仓库变成旧方案/备用方案。`

---

## 为什么要这么改

原因很简单：

- 用户体验更自然
- 不用手输路径
- 更像真实产品
- 更适合演示
- 更适合做 Web 版 AI Repo Assistant 的 MVP

---

## 你以后回顾时只要记住这 3 句话

1. Day 2 的本质，是把“手输路径”改成“选择文件夹”。
2. 现在主流程走前端 `localRepoService`，不是后端 `repoFsService`。
3. 页面负责组织流程，service 负责真正的仓库读取能力。