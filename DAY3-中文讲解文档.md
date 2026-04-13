# DAY3 中文讲解文档

这份文档讲的是 Day 3 做的事情：

- 把聊天从 mock 改成真实模型调用
- 把“选中的文件内容”真正带给模型
- 加上 SSE 流式返回
- 把服务端拆成更清楚的几层

你不用一次看完所有细节，先抓住主流程就够了。

---

## 1. Day 3 到底做了什么

Day 1 / Day 2 时，中间聊天区只是一个壳子：

- 前端有聊天框
- 后端有 `/api/chat`
- 但后端返回的是 mock 数据

Day 3 做的事情，就是把这条链路接成真的：

1. 前端收集用户输入的问题
2. 前端把“当前选中的上下文文件内容”一起打包
3. 服务端根据这些文件构建上下文
4. 服务端组装 prompt
5. 服务端调用 DashScope 兼容接口
6. 服务端把回答以 SSE 流式返回
7. 前端一边接收 token，一边更新聊天区

一句话总结：

`Day 3 把聊天从“假回复”升级成了“带仓库上下文的真实流式回复”。`

---

## 2. 这次最核心的设计思路

这次最重要的不是“接了模型”，而是你把代码拆成了几层。

这也是你后面面试最值得讲的点。

### 服务端拆成了 4 层

#### 1. `contextBuilder.ts`

负责：

- 接收前端传来的选中文件
- 做上下文预算控制
- 截断过长内容
- 生成最终给模型用的上下文文本
- 返回本轮用了哪些文件、哪些文件被截断

你可以理解成：

`把文件内容整理成模型能吃的上下文`

---

#### 2. `promptBuilder.ts`

负责：

- 定义 system prompt
- 把用户问题和上下文拼成一组 messages

你可以理解成：

`把“原始输入”变成“模型请求体”`

---

#### 3. `aiService.ts`

负责：

- 读取环境变量
- 调用 DashScope 接口
- 处理普通请求
- 处理流式请求
- 把 SSE 的 token 一段段解析出来

你可以理解成：

`纯模型调用层`

---

#### 4. `chatOrchestrator.ts`

负责：

- 把 `contextBuilder`、`promptBuilder`、`aiService` 串起来
- 做一次完整的“单轮编排”
- 对外提供：
  - `runChatTurn`
  - `streamChatTurn`

你可以理解成：

`Day 3 的 QueryEngine 简化版`

这就是你借 Claude Code 最像样的地方：

- 不做复杂 agent loop
- 但做了清楚的单轮编排

---

## 3. 为什么前端要把文件内容传给后端

这是 Day 3 一个特别关键的点。

你现在项目的仓库加载主流程已经不是：

- 后端读仓库

而是：

- 前端选文件夹
- 前端构建文件树
- 前端读取文件内容

这意味着：

`服务端并不知道你当前到底选了哪些文件，也拿不到这些文件内容。`

所以 Day 3 必须做一件事：

- 前端把 `selectedContextPaths` 对应的文件内容一起传给后端

这件事是在这里做的：

- [chatApi.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/services/chatApi.ts)

这里有个很关键的函数：

- `buildChatRequestPayload`

它会：

1. 遍历当前选中的路径
2. 调 `readSelectedRepoFile(path)`
3. 拿到每个文件的：
   - `path`
   - `language`
   - `content`
4. 拼成 `contextFiles`
5. 和用户输入 `message` 一起发给服务端

所以 Day 3 之后，请求体已经不只是：

- `message`
- `selectedPaths`

还多了：

- `contextFiles`

---

## 4. shared 层改了什么

文件：

- [index.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/shared/src/index.ts)

这个文件是 Day 3 很重要的一步，因为你扩展了前后端共享协议。

新增了这些结构：

### `selectedContextFileSchema`

描述单个上下文文件：

- `path`
- `language`
- `content`

### `chatContextMetaSchema`

描述本轮上下文信息：

- `usedContextPaths`
- `truncatedPaths`
- `totalCharacters`

### `chatStreamEventSchema`

描述 SSE 流式事件，分成 4 类：

- `context`
- `chunk`
- `done`
- `error`

这一步的意义是：

`SSE 不是随便吐字符串，而是有结构化事件协议。`

这点很值得你记住。

---

## 5. contextBuilder 在做什么

文件：

- [contextBuilder.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/contextBuilder.ts)

这里主要解决一个问题：

`上下文不能无限塞给模型。`

所以它做了 3 件事：

1. 限制文件数量
- 最多只吃 5 个文件

2. 限制总上下文字符数
- `MAX_TOTAL_CONTEXT_CHARS = 12000`

3. 限制单个文件最大长度
- `MAX_SINGLE_FILE_CHARS = 3600`

如果文件太长，就会被截断，并记录在：

- `truncatedPaths`

最后它返回两个东西：

### `contextText`

这是给模型看的纯文本上下文，格式大概像：

```txt
FILE: src/pages/LoginPage.tsx
LANGUAGE: tsx
CONTENT START
...
CONTENT END
```

### `contextMeta`

这是给前端和调试看的结构化信息：

- 用了哪些文件
- 哪些文件被截断
- 一共传了多少字符

这就是 Day 3 里“借 Claude Code 的上下文预算思路”的体现。

---

## 6. promptBuilder 在做什么

文件：

- [promptBuilder.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/promptBuilder.ts)

它做的事比较单纯：

- 定义 system prompt
- 把用户请求、选中文件路径、上下文文本拼起来
- 输出模型 messages

输出结果大概长这样：

- 一条 `system`
- 一条 `user`

其中 `user` 里会包含：

- `USER REQUEST`
- `SELECTED FILE PATHS`
- `REPOSITORY CONTEXT`

这样做的好处是：

- 提示词逻辑集中管理
- 不会把 prompt 拼接逻辑散在路由里
- 后面你要调 prompt，只改这一个文件

---

## 7. aiService 在做什么

文件：

- [aiService.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/aiService.ts)

它是 Day 3 里最像“基础设施层”的部分。

主要做了这些事：

### 1. 读取环境变量

它现在会显式尝试读取：

- 根目录 `.env`
- `server/.env`

这样就不会再依赖 Bun 的隐式行为。

### 2. 调普通聊天接口

函数：

- `generateChatCompletion`

用于 `/api/chat`

### 3. 调流式聊天接口

函数：

- `streamChatCompletion`

用于 `/api/chat/stream`

### 4. 解析 SSE 数据

它会从 DashScope 返回的流里不断读取：

- `data: ...`
- `data: [DONE]`

然后提取 token，逐个交给上层：

- `handlers.onToken(token)`

所以你可以把它理解成：

`把模型的底层协议，翻译成你应用可以用的函数调用。`

---

## 8. chatOrchestrator 在做什么

文件：

- [chatOrchestrator.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/chatOrchestrator.ts)

它是 Day 3 服务端最核心的“业务主线”。

### 非流式

函数：

- `runChatTurn`

流程是：

1. `buildContextPayload`
2. `buildChatMessages`
3. `generateChatCompletion`
4. 包装成 `ChatResponse`

### 流式

函数：

- `streamChatTurn`

流程是：

1. `buildContextPayload`
2. 把 `contextMeta` 先发给前端
3. `buildChatMessages`
4. `streamChatCompletion`
5. 一边收到 token，一边推给前端
6. 最后组装完整 assistant message

这就是“单轮编排”的完整体现。

---

## 9. chat 路由怎么工作的

文件：

- [chat.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/routes/chat.ts)

这里现在有两条路由：

### 1. `/api/chat`

普通模式，用来兜底。

- 适合调试
- 流式失败时前端回退用

### 2. `/api/chat/stream`

流式模式，是 Day 3 主链路。

它做的事情：

- `reply.hijack()`
- 设置 `text/event-stream`
- 把 `context / chunk / done / error` 按 SSE 格式写回去

这里你要记住一个点：

前端不是直接吃模型 SSE，而是先吃你自己服务端定义过的 SSE 事件。

也就是说，中间多了一层“你自己的流式协议”。

这很重要。

---

## 10. 前端 chatApi 在做什么

文件：

- [chatApi.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/services/chatApi.ts)

这里是前端聊天接口层。

主要有 3 个函数：

### 1. `buildChatRequestPayload`

作用：

- 收集选中的文件内容
- 生成请求体

### 2. `sendChatRequest`

作用：

- 调普通 `/api/chat`
- 作为 fallback

### 3. `streamChatRequest`

作用：

- 调 `/api/chat/stream`
- 读取浏览器 `ReadableStream`
- 解析 SSE
- 把事件一个个回调给页面

所以你可以理解成：

`chatApi 是前端版的聊天传输层。`

---

## 11. Zustand store 改了什么

文件：

- [useWorkspaceStore.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/store/useWorkspaceStore.ts)

Day 3 为了支持 SSE，store 多了几块状态：

### 新状态

- `lastContextMeta`
- `streamingAssistantId`

### 新方法

- `beginAssistantStream`
- `appendAssistantStreamChunk`

### 原方法升级

- `finishAssistantMessage`

这套状态流是这样的：

1. 用户发消息
2. 先追加一条 user message
3. 服务端返回 `context` 事件后，创建一条空的 assistant message
4. 每收到一个 `chunk`，就往这条 assistant message 后面拼字符串
5. 收到 `done`，再把最终完整 message 替换进去

这就是为什么聊天区能实现“边生成边显示”。

---

## 12. 页面主链路怎么跑

文件：

- [FolderPickerWorkspacePage.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/pages/FolderPickerWorkspacePage.tsx)

这里最关键的是：

- `handleSendMessage`

你可以把它理解成 Day 3 前端的“迷你控制器”。

流程是：

1. 取用户输入
2. 追加 user message
3. `buildChatRequestPayload`
4. 调 `streamChatRequest`
5. 处理 4 类流事件：
   - `context`
   - `chunk`
   - `done`
   - `error`
6. 如果流式失败，再回退到 `sendChatRequest`

这里值得你重点记住的是：

`流式是主链路，普通请求是兜底链路。`

---

## 13. ChatPanel 改了什么

文件：

- [ChatPanel.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/components/ChatPanel.tsx)

Day 3 这里主要加了一个小亮点：

- 展示“上一次回答用了哪些文件”
- 展示“哪些文件因为上下文预算被截断了”

这块对应 store 里的：

- `lastContextMeta`

所以 UI 不只是“能聊天”，而是能体现：

`模型这次到底看了哪些仓库上下文。`

这个点很适合面试讲。

---

## 14. 为什么 Day 3 这版是合理的

这版的价值就在于：

### 1. 没有贪心做 agent loop

你没有一步冲太重，而是先把“单轮聊天 + 上下文 + 流式”打稳。

### 2. 借了 Claude Code 的思路，但没照搬

你借的是：

- 单轮编排
- 能力分层
- 上下文预算
- 单一状态源

没做的是：

- agent loop
- 自动工具调用
- 多步规划
- 工作树/回滚

这很合理。

### 3. 架构已经能继续长

Day 4 以后你完全可以沿着这套结构继续做：

- 真正的 diff suggestion
- 文件修改提案
- 命令执行
- 更细的上下文选择

---

## 15. 你以后复习时只记住这 5 句话

1. Day 3 的本质，是把聊天从 mock 升级成真实模型调用。
2. 因为仓库主流程在前端，所以前端必须把选中的文件内容一起传给后端。
3. 服务端拆成了 `contextBuilder + promptBuilder + aiService + chatOrchestrator`。
4. 流式主链路走 `/api/chat/stream`，普通 `/api/chat` 只是 fallback。
5. store 通过“占位 assistant message + chunk 追加 + done 替换”实现了 SSE 聊天体验。

---

## 16. 推荐阅读顺序

如果你之后回看代码，建议按这个顺序读：

1. [FolderPickerWorkspacePage.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/pages/FolderPickerWorkspacePage.tsx)
2. [chatApi.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/services/chatApi.ts)
3. [useWorkspaceStore.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/store/useWorkspaceStore.ts)
4. [chat.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/routes/chat.ts)
5. [chatOrchestrator.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/chatOrchestrator.ts)
6. [contextBuilder.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/contextBuilder.ts)
7. [promptBuilder.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/promptBuilder.ts)
8. [aiService.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/aiService.ts)

这样读会最顺。

---

## 17. SSE 请求完整链路怎么走

如果你以后忘了，就记住一句话：

`前端页面发起请求 -> chatApi 处理传输 -> 后端 chat 路由返回 SSE -> orchestrator 编排 -> aiService 调模型 -> 再把 chunk 一段段推回前端 -> Zustand 把 chunk 追加到当前 assistant 消息上。`

下面按真正的执行顺序串起来。

### 第 1 步：用户点击发送

文件：
- [FolderPickerWorkspacePage.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/pages/FolderPickerWorkspacePage.tsx)

关键函数：
- `handleSendMessage`

它做了这些事：

1. 取出输入框里的文本 `draftMessage`
2. 调 `appendUserMessage`，先把用户消息放进聊天区
3. 调 `startSendingMessage`，把 store 切到“正在发送”状态
4. 调 `buildChatRequestPayload`
5. 调 `streamChatRequest`
6. 根据流式事件类型，分别处理 `context / chunk / done / error`
7. 如果 SSE 失败，再回退到普通 `sendChatRequest`

你可以把 `handleSendMessage` 理解成：

`Day 3 前端聊天主链路的总控制器`

---

### 第 2 步：前端组装聊天请求体

文件：
- [chatApi.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/services/chatApi.ts)

关键函数：
- `buildChatRequestPayload`

它做了什么：

1. 接收 `message` 和 `selectedPaths`
2. 遍历当前选中的上下文文件路径
3. 对每个路径调用 `readSelectedRepoFile`
4. 把文件内容整理成 `contextFiles`
5. 最终返回一个 `ChatRequest`

为什么这一步重要：

因为现在仓库主流程是在前端选文件夹、前端持有文件对象，所以后端默认并不知道“你选中了哪些文件内容”。  
因此前端必须把：

- 用户问题
- 选中的路径
- 对应文件内容

一起打包发给后端。

---

### 第 3 步：前端真正发起 SSE 请求

文件：
- [chatApi.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/services/chatApi.ts)

关键函数：
- `streamChatRequest`

它做了什么：

1. 用 `fetch('/api/chat/stream')` 发起 POST 请求
2. 从 `response.body.getReader()` 拿到可读流
3. 用 `TextDecoder` 持续解码服务端返回的数据块
4. 用 `\n\n` 作为 SSE 事件边界切分事件
5. 提取每一行 `data: ...`
6. `JSON.parse`
7. 再用 `chatStreamEventSchema.parse` 做一层结构校验
8. 最后把事件交给页面传进来的 `handlers.onEvent`

这一步的本质是：

`把浏览器底层字节流，转成前端可消费的结构化事件对象。`

---

### 第 4 步：后端 chat 路由接住流式请求

文件：
- [chat.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/routes/chat.ts)

关键函数：
- `registerChatRoutes`

其中和 SSE 相关的是：
- `app.post('/api/chat/stream', ...)`

它做了什么：

1. 先用 `chatRequestSchema.parse(request.body)` 校验请求体
2. 调 `reply.hijack()`，直接接管原始响应流
3. 写入 SSE 响应头：
   - `Content-Type: text/event-stream`
   - `Cache-Control: no-cache`
   - `Connection: keep-alive`
4. 调 `streamChatTurn`
5. 在 `onContext` 回调里发一条 `context` 事件
6. 在 `onChunk` 回调里每次发一条 `chunk` 事件
7. 全部结束后再发一条 `done` 事件
8. 如果中途报错，就发一条 `error` 事件

里面还有一个小工具函数：
- `writeSseEvent`

它的职责很单纯：

`把普通对象包装成 SSE 格式的 data: xxx\\n\\n 并写到响应流里。`

---

### 第 5 步：chatOrchestrator 做单轮编排

文件：
- [chatOrchestrator.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/chatOrchestrator.ts)

关键函数：
- `streamChatTurn`

它做了什么：

1. 调 `buildContextPayload(input.contextFiles)` 生成上下文文本和上下文元数据
2. 调 `buildChatMessages(...)` 生成最终发给模型的 messages
3. 先把 `context.contextMeta` 通过 `handlers.onContext` 发出去
4. 再调 `streamChatCompletion(...)`
5. 模型每吐出一个 token / chunk，就通过 `handlers.onChunk` 往上抛
6. 等流式生成结束后，再把完整回答组装成 `ChatResponse`

这里最值得记的是：

`chatOrchestrator 不直接关心 HTTP，也不直接关心前端 UI，它只负责把“上下文构建 + prompt 组装 + 模型调用”串成一次完整聊天。`

这就是你借鉴 Claude Code 的“单轮编排”思路。

---

### 第 6 步：contextBuilder 先整理上下文

文件：
- [contextBuilder.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/contextBuilder.ts)

关键函数：
- `buildContextPayload`

它做了什么：

1. 只取有限数量的上下文文件
2. 控制单文件最大字符数
3. 控制总上下文字符预算
4. 把每个文件整理成“路径 + 内容”的文本块
5. 记录：
   - `usedContextPaths`
   - `truncatedPaths`
   - `totalCharacters`

所以它的职责不是“聪明理解代码”，而是：

`先把上下文变成一个大小可控、结构清楚、可追踪的输入。`

---

### 第 7 步：promptBuilder 负责把请求变成模型能读的 messages

文件：
- [promptBuilder.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/promptBuilder.ts)

关键函数：
- `buildChatMessages`

它做了什么：

1. 生成 system message
2. 生成 user message
3. 把用户问题、选中文件路径、上下文文本拼到一起
4. 输出最终的 `messages`

你可以把它理解成：

`把“前端发来的原始信息”翻译成“模型 API 能直接消费的标准输入”。`

---

### 第 8 步：aiService 真正调用大模型并读取上游流

文件：
- [aiService.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/aiService.ts)

关键函数：
- `streamChatCompletion`

它做了什么：

1. 读取环境变量里的模型配置
2. 请求 DashScope 兼容接口
3. 打开上游模型返回的流
4. 持续读取每个数据块
5. 解析上游 SSE / 流式 JSON 片段
6. 拿到增量文本后调用 `onToken`
7. 同时把完整回答累积起来
8. 最后返回完整回复文本

所以 `streamChatCompletion` 的角色是：

`把“模型供应商的流式协议”翻译成“系统内部统一的 onToken 回调”。`

这一步把外部 API 细节封装掉了，后面如果换模型，主要改这里。

---

### 第 9 步：后端把 chunk 推回前端

还是这两层在配合：

- [aiService.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/aiService.ts)
- [chatOrchestrator.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/services/chatOrchestrator.ts)
- [chat.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/server/src/routes/chat.ts)

传播顺序是：

1. 模型返回一个 token
2. `aiService.streamChatCompletion` 收到后调用 `onToken`
3. `chatOrchestrator.streamChatTurn` 把这个 token 转成 `handlers.onChunk`
4. `chat.ts` 的 `onChunk` 回调收到后，用 `writeSseEvent` 写成一条 `chunk` 事件
5. 浏览器收到这条 SSE 事件

也就是：

`模型 token -> aiService -> chatOrchestrator -> chat route -> 浏览器`

---

### 第 10 步：前端把 chunk 一点点渲染到聊天区

文件：
- [FolderPickerWorkspacePage.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/pages/FolderPickerWorkspacePage.tsx)
- [useWorkspaceStore.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/store/useWorkspaceStore.ts)

关键函数：
- 页面里的 `handleSendMessage`
- store 里的：
  - `beginAssistantStream`
  - `appendAssistantStreamChunk`
  - `finishAssistantMessage`

处理顺序是：

#### 收到 `context`

页面会调用：
- `beginAssistantStream(event.contextMeta)`

它会：

1. 记住 `lastContextMeta`
2. 创建一条空的 assistant message
3. 记录这条消息的 `streamingAssistantId`

#### 收到 `chunk`

页面会调用：
- `appendAssistantStreamChunk(event.content)`

它会：

1. 根据 `streamingAssistantId` 找到那条正在流式更新的 assistant message
2. 把新 chunk 直接拼到 `message.content` 后面

所以你在 UI 上看到的“字一个个长出来”，本质就是：

`每来一段 chunk，就往同一条 assistant message 后面继续追加文本。`

#### 收到 `done`

页面会调用：
- `finishAssistantMessage(event.reply, event.diffPreview ?? null, event.contextMeta)`

它会：

1. 用服务端返回的最终完整 assistant message 替换掉之前那条占位消息
2. 写入 `diffPreview`
3. 更新 `lastContextMeta`
4. 把 `isSendingMessage` 改回 `false`
5. 清空 `streamingAssistantId`

---

### 第 11 步：如果 SSE 失败，就走 fallback

文件：
- [FolderPickerWorkspacePage.tsx](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/pages/FolderPickerWorkspacePage.tsx)
- [chatApi.ts](/d:/claude-code/claude-code-rev/ai-repo-assisant/web/src/services/chatApi.ts)

关键函数：
- `sendChatRequest`

逻辑是：

1. `streamChatRequest` 报错
2. 页面 catch 到异常
3. 再调用普通 `/api/chat`
4. 如果普通请求成功，就正常 `finishAssistantMessage`
5. 如果 fallback 也失败，就生成一条错误 assistant message

这保证了：

`就算流式链路挂了，用户至少还能看到一次完整回复或错误信息。`

---

### 第 12 步：你以后复习时怎么背这条链

最短记忆版：

1. `handleSendMessage` 发起整条聊天流程
2. `buildChatRequestPayload` 负责把选中文件内容带上
3. `streamChatRequest` 把 SSE 字节流转成事件对象
4. `chat.ts` 负责把后端结果写成 SSE 事件
5. `streamChatTurn` 负责单轮编排
6. `buildContextPayload` 负责上下文预算
7. `buildChatMessages` 负责 prompt 组装
8. `streamChatCompletion` 负责和模型供应商通信
9. `appendAssistantStreamChunk` 负责把 chunk 追加到 UI
10. `finishAssistantMessage` 负责收尾

你可以把整条链压缩成一句：

`前端组包 -> 前端发流 -> 后端编排 -> 模型吐 chunk -> 后端转 SSE -> 前端逐段追加 -> done 收尾。`
