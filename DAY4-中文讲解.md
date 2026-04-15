# DAY4-中文讲解

这份文档是给你之后回顾 Day 4 用的，重点不是逐行翻译代码，而是帮你快速想起来：

1. Day 4 最终做成了什么
2. 多文件 diff / 审批链路现在怎么走
3. 为什么后来又补了一次“普通代码块也能触发 diff”的修复
4. 你应该先看哪些文件

---

## 1. Day 4 最终做成了什么

Day 4 把项目从：

`代码问答助手`

推进成了：

`支持多文件建议、按文件切换 diff、逐个审批应用的代码修改助手`

现在这版能做到：

- 基于多个选中文件一起提问
- 模型一次返回多个文件的修改建议
- 右侧按文件切换查看 diff
- 每个文件单独“应用修改”或“放弃建议”
- 审批通过后，直接写回本地已选文件夹中的真实文件
- 继续保留轻量多轮对话

一句话总结：

`现在已经不是单文件 diff demo，而是一个最小可用的多文件代码建议审批流。`

---

## 2. 为什么选“多文件逐个 diff / 逐个应用”

你当时有两个方向：

1. 多文件建议列表，逐个查看 diff，逐个应用
2. 一次生成一个多文件变更集，然后一键全部应用

最后选了第一种，因为它：

- 最接近你当时已有的代码结构
- 改动最小
- 更稳
- 更容易讲清楚
- 审批粒度更细，更符合“AI 修改要可控”的思路

所以 Day 4 的核心设计是：

`支持多文件建议，但每个文件依然单独审阅、单独应用。`

---

## 3. shared 层改了什么

关键文件：

- [shared/src/index.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/shared/src/index.ts)

以前的结构更偏单文件：

- `diffPreview`
- `pendingSuggestion`

Day 4 改成了数组：

- `diffPreviews[]`
- `pendingSuggestions[]`

这意味着：

- 普通 `/api/chat`
- SSE `/api/chat/stream`

最后都可以一次返回多个文件建议。

一句话理解：

`shared 层先把“单文件建议”升级成了“多文件建议列表”。`

---

## 4. 后端怎么把模型回复变成多个 diff

关键文件：

- [server/src/services/chatOrchestrator.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/chatOrchestrator.ts)

这是 Day 4 最核心的后端文件。

### 4.1 `extractSuggestions`

这是 suggestion 提取入口。

它现在会按两层策略工作：

第一层：优先识别标准结构化建议

- `CODE_SUGGESTION_START`
- `Target Path`
- `Summary`
- 完整代码块
- `CODE_SUGGESTION_END`

第二层：如果模型没按标准格式来，但返回了这种内容：

- `mathHelpers.ts`
- 一个普通代码块
- `reportService.ts`
- 另一个普通代码块

那么现在也会走一个兜底解析，把它尽量恢复成 suggestion。

这个兜底逻辑是后来补的，原因是你发现：

`模型有时会只返回“文件名标题 + 普通 markdown 代码块”，导致明明像改代码，却没有触发 diff。`

所以现在的系统不再只认一种格式，而是：

`优先认标准 suggestion，必要时也尽量救回普通代码块。`

### 4.2 `mapTargetPath`

模型有时返回短路径，比如：

- `components/ChatPanel.tsx`

但你真实上下文文件路径可能是：

- `web/src/components/ChatPanel.tsx`

这个函数负责做路径映射，让模型返回的路径尽量对上当前已选文件。

### 4.3 `buildSuggestionPayload`

这个函数负责把提取出的 suggestion 进一步整理成：

- `diffPreviews[]`
- `pendingSuggestions[]`

它还会做两层安全检查：

1. 目标文件必须属于当前上下文文件
2. 建议内容不能明显像“半截文件”

如果建议太短、像被截断了，就不会进入 diff / 审批链路。

一句话理解：

`chatOrchestrator 负责把模型回复整理成系统真正能用的建议列表。`

---

## 5. 为什么聊天区不会再直接显示大段代码块

关键函数：

- `buildVisibleReply`

以前如果模型返回建议块，聊天区有时会直接看到整大段代码。

后来我们做了调整：

- 如果已经成功提取出 suggestion
- 聊天区就优先显示简短说明
- 右侧 diff 面板负责展示真正的代码改动

这样做的好处是：

- 聊天区更干净
- 不会一边有 diff，一边又在聊天区重复贴完整代码

---

## 6. promptBuilder 为什么也要改

关键文件：

- [server/src/services/promptBuilder.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/promptBuilder.ts)

Day 4 里，promptBuilder 不是为了改架构，而是为了提高 suggestion 命中率。

后来又补了一轮规则，主要是告诉模型：

- 如果用户要的是“可应用修改建议”，优先返回 `CODE_SUGGESTION`
- 不要只贴普通 raw code fences
- 多文件修改时，一个文件一个 suggestion block

还专门加了一个多文件 suggestion 示例。

一句话理解：

`promptBuilder 的作用是尽量把模型往“可编辑建议”而不是“普通聊天回答”上引导。`

---

## 7. 前端 store 怎么接住多文件建议

关键文件：

- [web/src/store/useWorkspaceStore.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/store/useWorkspaceStore.ts)

Day 4 里最重要的状态新增是：

- `diffPreviews`
- `pendingSuggestions`
- `activeSuggestionIndex`

这三个状态组合起来，就能支持：

- 一次拿到多个文件建议
- 当前只查看其中一个
- 切换查看不同文件
- 应用或放弃当前文件建议

其中最关键的思路是：

`建议列表是数组，但 UI 当前只聚焦一个激活项。`

这样既支持多文件，又不会让右侧面板太乱。

---

## 8. 页面主链路怎么走

关键文件：

- [web/src/pages/FolderPickerWorkspacePage.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/pages/FolderPickerWorkspacePage.tsx)

这个文件是 Day 4 的总控。

### `handleSendMessage`

负责：

1. 取输入框内容
2. 取最近几条有效历史消息
3. 构造请求
4. 调 SSE
5. 收到 `done` 后把：
   - `reply`
   - `diffPreviews`
   - `pendingSuggestions`
   - `contextMeta`
   一起交给 store

### `handleApplySuggestion`

负责：

1. 取当前激活的建议
2. 调 `writeSelectedRepoFile`
3. 成功后刷新当前文件内容
4. 调 `removeSuggestionAt(index)`
5. 给聊天区补一条“已应用修改”的提示

### `handleDiscardSuggestion`

负责：

1. 直接按索引删除该建议
2. 不写文件

一句话理解：

`页面层负责把“多文件建议列表”和“单文件审批动作”串起来。`

---

## 9. InspectorPanel 现在怎么展示多文件 diff

关键文件：

- [web/src/components/InspectorPanel.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/components/InspectorPanel.tsx)

Day 4 最明显的 UI 变化就在这里。

现在右侧不是只显示一个静态 diff，而是：

- 上面有一个轻量切换器
- 每个按钮对应一个文件建议
- 点哪个，就看哪个 diff

也就是说：

`一次返回多个建议，但右侧一次只专注展示一个文件的 diff。`

这是一个很稳的折中：

- 支持多文件
- 但不会把页面搞得太复杂

---

## 10. 为什么审批应用修改仍然走前端文件句柄

关键文件：

- [web/src/services/localRepoService.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/services/localRepoService.ts)

关键函数：

- `writeSelectedRepoFile`

原因很简单：

你当前的仓库来源是：

`浏览器里由用户自己选择的本地文件夹`

所以最稳的方式仍然是：

- 前端保留文件句柄
- 用户审批通过后
- 直接由前端把内容写回这个文件

而不是让后端去猜浏览器当前选中的真实绝对路径。

这也解释了为什么 Day 4 里“审批后应用修改”最后选的是前端写回，而不是纯后端写回。

---

## 11. 轻量多轮现在是什么状态

Day 4 没把多轮做成复杂记忆系统，还是轻量版。

关键文件：

- [web/src/pages/FolderPickerWorkspacePage.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/pages/FolderPickerWorkspacePage.tsx)
- [server/src/services/promptBuilder.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/promptBuilder.ts)

现在逻辑是：

- 前端只保留最近 6 条有效消息
- 会过滤欢迎语、系统消息、无意义错误消息
- 后端把这些历史消息拼进最终 messages

一句话理解：

`Day 4 的多轮还是轻量版，只是为了保持连续对话体验，没有引入复杂记忆系统。`

---

## 12. 后来为什么又补了一次“diff 触发修复”

这是 Day 4 后续非常值得记住的一次补丁。

你当时发现一个问题：

- 明明让模型“给两个文件加中文注释”
- 模型也回了两个代码块
- 但系统没有触发 diff

原因不是 diff 面板坏了，而是：

`系统当时只稳定识别 CODE_SUGGESTION 格式，不认“文件名标题 + 普通代码块”。`

所以后来补了两件事：

1. 后端加 fallback 解析  
   普通代码块如果能识别出文件名，也尽量转成 suggestion

2. 前端输入区加更明确的提示语  
   提醒用户直接请求“可应用的完整文件修改建议”

这次补丁后，diff 触发率会更稳定。

---

## 13. ChatPanel 现在多了什么

关键文件：

- [web/src/components/ChatPanel.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/components/ChatPanel.tsx)

这个文件现在除了展示聊天，还承担两个小作用：

1. 展示上下文摘要  
   告诉你上一轮回答用了哪些文件，哪些文件因为预算被截断

2. 提示更适合触发 diff 的输入方式  
   例如：

`给这两个文件添加中文注释，并直接返回可应用的完整文件修改建议。`

这不是架构核心，但很实用，因为它能明显提高你测试时的命中率。

---

## 14. 你现在复习代码时建议这样看

推荐顺序：

1. [FolderPickerWorkspacePage.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/pages/FolderPickerWorkspacePage.tsx)
2. [InspectorPanel.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/components/InspectorPanel.tsx)
3. [useWorkspaceStore.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/store/useWorkspaceStore.ts)
4. [localRepoService.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/services/localRepoService.ts)
5. [chatOrchestrator.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/chatOrchestrator.ts)
6. [promptBuilder.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/promptBuilder.ts)
7. [ChatPanel.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/components/ChatPanel.tsx)
8. [shared/src/index.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/shared/src/index.ts)

为什么这样看：

- 先看页面行为
- 再看状态管理
- 再看文件写回
- 再看后端怎么生成建议
- 最后看协议层

---

## 15. 面试时怎么讲 Day 4

你可以这样讲：

我在原有仓库级问答和 SSE 流式回复的基础上，继续扩展了代码建议链路。最开始系统只支持单文件 diff，后面我把 shared 协议升级成多文件建议列表，让后端可以从一次模型回复里提取多个 suggestion block，并在前端按文件切换查看 diff。为了保证可控性，我没有直接做批量一键应用，而是采用“多文件建议列表 + 按文件逐个 diff 审阅、逐个审批应用”的方式。

后来我又补了一次稳定性修复。因为我发现模型有时不会严格返回标准 suggestion block，而是只给“文件名标题 + 普通代码块”。所以我在 orchestrator 里增加了 fallback 解析，让这类回复也能尽量进入 diff 链路，同时继续保留对半截文件建议的拦截，避免错误内容被直接应用。

因为当前项目是浏览器本地选择文件夹的架构，所以最终应用修改仍然优先走前端文件句柄写回，而不是完全依赖后端绝对路径写文件，这样和当前主流程更一致，也更稳定。

---

## 16. 最后只记住这 7 句话

1. Day 4 现在支持多文件建议，但仍然逐个审阅、逐个应用。
2. shared 层已经从单个 `diffPreview / pendingSuggestion` 升级成数组结构。
3. 后端 `chatOrchestrator` 不只会提取标准 suggestion block，也会兜底识别“文件名 + 普通代码块”。
4. 右侧 Inspector 通过 `activeSuggestionIndex` 一次只聚焦一个文件的 diff。
5. 审批应用修改仍然走前端文件句柄，因为仓库是浏览器选出来的。
6. 轻量多轮还在，只保留最近几条有效消息。
7. Day 4 后续补丁的重点，是让 diff 更稳定触发，而不是再把架构做重。
