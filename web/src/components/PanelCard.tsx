import type { ReactNode } from 'react'

type PanelCardProps = {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}

// PanelCard 是三栏区域共用的面板外壳。
// 它只负责统一头部、边框和内容区域，不关心具体业务逻辑。
export function PanelCard({ title, subtitle, actions, children }: PanelCardProps) {
  return (
    <section className="panel-card">
      <header className="panel-card__header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="panel-card__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel-card__actions">{actions}</div> : null}
      </header>
      <div className="panel-card__body">{children}</div>
    </section>
  )
}
