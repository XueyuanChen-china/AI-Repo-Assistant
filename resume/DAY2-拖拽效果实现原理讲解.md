# DAY2 拖拽效果实现原理讲解

这份文档专门讲清楚两个问题：

1. `WorkspacePageExpired.tsx` 到底负责什么
2. 左右拖拽缩放真正是怎么实现的，配合了哪些 CSS

---


## 3. 真正的拖拽逻辑在哪

真正的核心文件是：

`web/src/components/WorkspaceSplitLayout.tsx`

这个组件干了 4 件关键的事：

1. 保存左右栏宽度
2. 渲染两条可拖拽分隔条
3. 在拖动时实时更新宽度
4. 限制左右栏不能拖得太夸张，保护中间列可用

---

## 4. 第一步：用 state 保存左右栏宽度

代码里有这样一组类型和默认值：

```ts
const DEFAULT_WIDTHS = {
  left: 280,
  right: 420,
}
```

再配合：

```ts
const [widths, setWidths] = useState(() => readStoredWidths())
```

这表示：

- 左栏默认 280px
- 右栏默认 420px
- 中间栏不直接存宽度，而是自动占剩余空间

为什么中间栏不单独存宽度？

因为三栏布局里最合理的做法通常是：

- 左边固定一个宽度
- 右边固定一个宽度
- 中间自动撑满剩余空间

这样最像 VSCode / Cursor 这类布局习惯。

---

## 5. 第二步：渲染两条“拖拽条”

在 `WorkspaceSplitLayout.tsx` 里，结构大概是这样：

```tsx
<div className="workspace-column workspace-column--left" style={{ width: `${widths.left}px` }}>
  {left}
</div>

<div className="workspace-splitter" ... />

<div className="workspace-column workspace-column--center">{center}</div>

<div className="workspace-splitter" ... />

<div className="workspace-column workspace-column--right" style={{ width: `${widths.right}px` }}>
  {right}
</div>
```

这里很重要：

- 第一条 `workspace-splitter` 控制左栏宽度
- 第二条 `workspace-splitter` 控制右栏宽度
- 中间列没有固定宽度，自动吃剩余空间

所以拖拽条本质上不是“移动 DOM”，而是：

`用一个窄条元素当手柄，然后改左右栏的 width`。

---

## 6. 第三步：拖拽开始时记录初始状态

在组件里有一个 `dragStateRef`，它用来记录拖拽刚开始时的信息：

```ts
type DragState = {
  side: 'left' | 'right'
  startX: number
  startLeftWidth: number
  startRightWidth: number
}
```

当你按下拖拽条时，会调用：

```ts
startDragging(side, event)
```

它会记住：

- 你拖的是左边还是右边
- 鼠标按下那一刻的横坐标 `startX`
- 当时左栏宽度
- 当时右栏宽度

这样后面鼠标一移动，就能算出“当前应该加宽还是缩窄多少”。

---

## 7. 第四步：拖动过程中根据鼠标位移改宽度

真正的拖动核心在这里：

```ts
const deltaX = event.clientX - dragState.startX
```

这个 `deltaX` 的意思是：

- 鼠标往右拖，`deltaX` 为正
- 鼠标往左拖，`deltaX` 为负

如果拖的是左栏：

```ts
left: dragState.startLeftWidth + deltaX
```

表示：

- 往右拖，左栏变宽
- 往左拖，左栏变窄

如果拖的是右栏：

```ts
right: dragState.startRightWidth - deltaX
```

表示：

- 往右拖，右栏变窄
- 往左拖，右栏变宽

这里为什么右栏是减号？

因为右栏是在右边，鼠标往右走，相当于分隔线向右移动，右栏空间会减少。

---

## 8. 第五步：为什么要 `normalizeWidths`

如果你只是简单改宽度，会出现几个问题：

- 左栏可能被拖到 10px
- 右栏可能被拖到特别大
- 中间列可能被挤没了

所以组件里专门写了一个：

```ts
normalizeWidths(widths, containerWidth)
```

它的作用是“收口和纠偏”。

它做了这些限制：

- 左栏最小宽度：`220px`
- 中间列最小宽度：`320px`
- 右栏最小宽度：`280px`

也就是说，拖拽虽然自由，但不会拖到布局坏掉。

这是编辑器类产品很常见的做法。

---

## 9. 第六步：为什么还要监听 `resize`

组件里还有这段：

```ts
window.addEventListener('resize', syncWidthsToContainer)
```

原因是：

当浏览器窗口大小变化时，如果不重新计算，原来保存的左右宽度可能会不合理。

比如：

- 你原来屏幕很宽，左栏 360px、右栏 480px 很正常
- 窗口突然缩小后，如果不重算，中间列可能被挤爆

所以这里会在窗口尺寸变化时重新执行 `normalizeWidths`，让布局重新回到合理状态。

---

## 10. 第七步：为什么要存到 localStorage

代码里有：

```ts
window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
```

还有：

```ts
readStoredWidths()
```

这表示：

- 你拖完之后的宽度会被记住
- 页面刷新后，左右栏还是你上次调整过的大小

这样用户体验会更像真正的 IDE，而不是每次刷新都回到默认值。

---

## 11. CSS 是怎么配合这个拖拽效果的

拖拽逻辑只靠 TS 不够，CSS 必须一起配合。

### 11.1 `workspace-grid`

```css
.workspace-grid {
  display: flex;
  align-items: stretch;
  height: 100%;
  overflow: hidden;
}
```

作用：

- 把三列排成横向布局
- 让它们都撑满同一高度
- 防止内容把整个工作区撑爆

这里为什么是 `flex` 而不是 `grid`？

因为这种“左右固定宽度 + 中间自适应 + 拖拽改宽度”的场景，用 `flex` 更直观。

---

### 11.2 `workspace-column`

```css
.workspace-column {
  display: flex;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
```

作用：

- 让列本身能撑满高度
- 允许内部子元素正确收缩
- 把滚动控制权交给里面真正该滚的区域

这里最容易被忽略的是：

- `min-width: 0`
- `min-height: 0`

这两个在 flex 布局里非常关键。没有它们，内部内容可能拒绝收缩，导致滚动失效或者列被撑开。

---

### 11.3 `workspace-splitter`

```css
.workspace-splitter {
  flex: 0 0 10px;
  min-width: 10px;
  cursor: col-resize;
  touch-action: none;
}
```

作用：

- 提供一个 10px 宽的可拖拽热区
- 鼠标移上去显示左右拖动光标
- `touch-action: none` 防止触控设备默认行为干扰拖拽

再配合：

```css
.workspace-splitter::after
```

去画中间那条可见的细线。

也就是说：

- 真正可点击区域是 10px
- 视觉上看到的是中间那条细线

这样既好拖，也不会太丑。

---

### 11.4 `body.is-resizing-panels`

```css
body.is-resizing-panels {
  cursor: col-resize;
  user-select: none;
}
```

作用：

拖拽过程中：

- 整个页面鼠标都保持左右拖拽样式
- 禁止文本被误选中

这个细节虽然小，但会让交互更像成熟产品。

---

## 12. 为什么还需要“固定视口高度”的 CSS

拖拽只是改变宽度。

如果你想让三列看起来像 VSCode，还需要让它们：

- 高度固定在视口内
- 各自独立滚动

所以还需要这些样式：

```css
.workspace-shell {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.workspace-main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.panel-card {
  height: 100%;
  overflow: hidden;
}
```

然后把真正的滚动给到：

- `.tree-root`
- `.chat-messages`
- `.code-block`

这和拖拽逻辑是两件事，但它们要一起工作，体验才像一个完整的 IDE 工作区。

---

## 13. 如果只看 `WorkspacePageExpired.tsx`，容易误解的地方

很多人第一次看这个文件，会误以为：

“是不是 `<main className="workspace-grid">` 本身就让三列能拖拽了？”

其实不是。

`workspace-grid` 这个 class 只能决定：

- 横向排列
- 间距
- 高度
- 溢出处理

它**不能自己产生拖拽交互**。

拖拽一定需要 JS 去做这些事：

- 记录鼠标按下的位置
- 监听鼠标移动
- 计算位移
- 更新宽度
- 鼠标松开时结束拖拽

所以真正的因果关系是：

- `WorkspacePageExpired.tsx` 提供三栏页面骨架
- `WorkspaceSplitLayout.tsx` 提供交互逻辑
- `app.css` 提供布局和视觉承载

---

## 14. 一句话总结

如果你问：

“`WorkspacePageExpired.tsx` 是怎么实现左右拖拽缩放的？”

最准确的回答是：

`它本身没有实现拖拽，它只是旧版三栏页面容器。真正的左右拖拽缩放，是由 WorkspaceSplitLayout.tsx 负责宽度状态和鼠标事件，再配合 app.css 里的 flex 布局、splitter 样式、固定高度和内部滚动样式一起实现的。`

---

## 15. 你应该按什么顺序读这套代码

推荐顺序：

1. `web/src/pages/WorkspacePageExpired.tsx`
2. `web/src/components/WorkspaceSplitLayout.tsx`
3. `web/src/styles/app.css`

阅读目标：

- 第一步看清楚“页面把谁摆进来了”
- 第二步看清楚“拖拽逻辑怎么改宽度”
- 第三步看清楚“CSS 怎么承接这些宽度和滚动效果”

---

## 16. 面试里可以怎么讲

你可以这样说：

“页面层只负责组织三栏结构，真正的可拖拽布局我单独抽成了一个 `WorkspaceSplitLayout` 组件。它通过状态保存左右栏宽度，使用 pointer 事件监听拖拽过程，并在每次拖动时根据鼠标位移更新宽度。同时我在 CSS 层用 flex 布局承接这个结构，并限制最小宽度、固定视口高度，把滚动控制在每个面板内部，这样整体体验更像编辑器工作区。”