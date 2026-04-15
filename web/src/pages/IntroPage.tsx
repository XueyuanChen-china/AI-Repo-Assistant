type IntroPageProps = {
  onEnterWorkspace: () => void
}

export function IntroPage({ onEnterWorkspace }: IntroPageProps) {
  return (
    <div className="intro-shell">
      <section className="intro-card">
        <div className="intro-card__header">
          <p className="intro-card__eyebrow">AI 仓库助手</p>
          <h1>面向代码仓库的 Web 编码助手</h1>
          <p className="intro-card__summary">
            这是一个偏工程工具风格的前端产品原型。它支持浏览本地项目、选择上下文文件、和 AI 对话、
            生成代码修改建议，并在右侧以 diff 形式审阅后再决定是否应用。
          </p>
        </div>

        <div className="intro-grid">
          <article className="intro-feature">
            <h2>仓库浏览</h2>
            <p>左侧展示文件树，可以打开文件并把需要的文件加入上下文。</p>
          </article>
          <article className="intro-feature">
            <h2>对话理解</h2>
            <p>中间支持仓库级问答和轻量多轮对话，回答时会参考你选择的代码文件。</p>
          </article>
          <article className="intro-feature">
            <h2>Diff 审阅</h2>
            <p>右侧会展示代码差异，你可以逐个文件查看建议，再决定是否应用修改。</p>
          </article>
        </div>

        <div className="intro-card__footer">
          <div className="intro-note">
            首次进入会先看到这个介绍页。点击下方按钮后，就会进入主工作区。
          </div>
          <button className="intro-cta" type="button" onClick={onEnterWorkspace}>
            开始使用
          </button>
        </div>
      </section>
    </div>
  )
}
