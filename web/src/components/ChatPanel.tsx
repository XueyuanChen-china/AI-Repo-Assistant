import type { WorkspaceMessage } from '@ai-repo-assistant/shared'

import { PanelCard } from './PanelCard'

type ChatPanelProps = {
  messages: WorkspaceMessage[]
  draftMessage: string
  selectedContextPaths: string[]
  isSendingMessage: boolean
  onDraftChange: (value: string) => void
  onSend: () => void
  onRemoveContext: (path: string) => void
}

function formatMessageTime(createdAt: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(createdAt))
}

function getMessageAuthorLabel(role: WorkspaceMessage['role']) {
  return role === 'assistant' ? 'AI 助手' : '我'
}

export function ChatPanel({
  messages,
  draftMessage,
  selectedContextPaths,
  isSendingMessage,
  onDraftChange,
  onSend,
  onRemoveContext,
}: ChatPanelProps) {
  const canSend = draftMessage.trim().length > 0 && !isSendingMessage

  return (
    <PanelCard
      title="对话"
      actions={<span className="context-count">{selectedContextPaths.length} 个上下文</span>}
    >
      <div className="chat-messages">
        {messages.map((message) => (
          <article key={message.id} className={`message message--${message.role}`}>
            <div className="message__meta">
              <strong>{getMessageAuthorLabel(message.role)}</strong>
              <span>{formatMessageTime(message.createdAt)}</span>
            </div>
            {message.role === 'assistant' && !message.content.trim() ? (
              <div className="message__thinking">
                <span className="chat-spinner" />
                <span>正在思考</span>
              </div>
            ) : (
              <p>{message.content}</p>
            )}
          </article>
        ))}
      </div>

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSend) {
            onSend()
          }
        }}
      >
        <div className="chat-composer__shell">
          {selectedContextPaths.length > 0 ? (
            <div className="composer-context-list">
              {selectedContextPaths.map((path) => (
                <span key={path} className="composer-context-chip">
                  <span className="composer-context-chip__label">{path}</span>
                  <button
                    className="composer-context-chip__close"
                    type="button"
                    aria-label={`移除 ${path}`}
                    onClick={() => onRemoveContext(path)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            rows={3}
            placeholder="例如：分析这个仓库的登录流程，或者直接给出可应用的完整代码修改建议。"
            value={draftMessage}
            onChange={(event) => onDraftChange(event.target.value)}
          />

          <div className="chat-composer__footer">
            <span className="chat-composer__status">
              {isSendingMessage ? (
                <>
                  <span className="chat-spinner" />
                  正在思考
                </>
              ) : selectedContextPaths.length > 0 ? (
                `本轮将参考 ${selectedContextPaths.length} 个上下文文件`
              ) : (
                '最多可选择 5 个上下文文件'
              )}
            </span>

            <button
              className="chat-send-button"
              disabled={!canSend}
              type="submit"
              aria-label={isSendingMessage ? '正在发送' : '发送'}
            >
              {isSendingMessage ? <span className="chat-send-button__spinner" /> : <span className="chat-send-button__icon">↑</span>}
            </button>
          </div>
        </div>
      </form>
    </PanelCard>
  )
}
