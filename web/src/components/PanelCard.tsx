import type { ReactNode } from 'react'

type PanelCardProps = {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}
//ReactNode 表示可以传入任何 React 内容（JSX、字符串、组件等）

// PanelCard 是一个通用“面板壳子”。
// 左侧文件树、中间聊天、右侧检查区都复用了它，避免每块都重复写相同布局。
export function PanelCard({ title, subtitle, actions, children }: PanelCardProps) {
  return (
    <section className="panel-card">
      <header className="panel-card__header">
        <div>
          <p className="panel-card__eyebrow">Day 1 scaffold</p>
          <h2>{title}</h2>
          {subtitle ? <p className="panel-card__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel-card__actions">{actions}</div> : null}
      </header>
      <div className="panel-card__body">{children}</div>
    </section>
  )
}
