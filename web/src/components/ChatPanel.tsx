import type { ChatContextMeta, WorkspaceMessage } from '@ai-repo-assistant/shared'

import { PanelCard } from './PanelCard'

type ChatPanelProps = {
  messages: WorkspaceMessage[]
  draftMessage: string
  selectedContextPaths: string[]
  lastContextMeta: ChatContextMeta | null
  isSendingMessage: boolean
  onDraftChange: (value: string) => void
  onSend: () => void
}

function formatMessageTime(createdAt: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(createdAt))
}

function buildContextSummary(contextMeta: ChatContextMeta | null) {
  if (!contextMeta) {
    return null
  }

  const usedText = contextMeta.usedContextPaths.length > 0 ? contextMeta.usedContextPaths.join(', ') : 'No file context used'
  const truncatedText = contextMeta.truncatedPaths.length > 0 ? contextMeta.truncatedPaths.join(', ') : null

  return {
    usedText,
    truncatedText,
  }
}

export function ChatPanel({
  messages,
  draftMessage,
  selectedContextPaths,
  lastContextMeta,
  isSendingMessage,
  onDraftChange,
  onSend,
}: ChatPanelProps) {
  const canSend = draftMessage.trim().length > 0 && !isSendingMessage
  const contextSummary = buildContextSummary(lastContextMeta)

  return (
    <PanelCard
      title="Conversation"
      subtitle="Ask a repo question or request a code change suggestion backed by selected files."
      actions={<span className="context-count">{selectedContextPaths.length} file(s) selected</span>}
    >
      <div className="chat-messages">
        {messages.map((message) => (
          <article key={message.id} className={`message message--${message.role}`}>
            <div className="message__meta">
              <strong>{message.role === 'assistant' ? 'AI 助手' : '我'}</strong>
              <span>{formatMessageTime(message.createdAt)}</span>
            </div>
            <p>{message.content || (message.role === 'assistant' ? '...' : '')}</p>
          </article>
        ))}
      </div>

      <div className="context-chip-list">
        {selectedContextPaths.length > 0 ? (
          selectedContextPaths.map((path) => (
            <span key={path} className="context-chip">
              {path}
            </span>
          ))
        ) : (
          <span className="context-chip context-chip--muted">最多选择 5 个文件</span>
        )}
      </div>

      {contextSummary ? (
        <div className="chat-context-meta">
          <p>Last answer used: {contextSummary.usedText}</p>
          {contextSummary.truncatedText ? <p>Trimmed for context budget: {contextSummary.truncatedText}</p> : null}
        </div>
      ) : null}

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSend) {
            onSend()
          }
        }}
      >
        <textarea
          rows={4}
          placeholder="请求示例：‘这个仓库的登录流程是怎样的？’或者‘请给我一个修改建议，优化登录相关的用户体验。’"
          value={draftMessage}
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <div className="chat-composer__footer">
          <p>Streaming from DashScope with selected-file context.</p>
          <button disabled={!canSend} type="submit">
            {isSendingMessage ? '思考中...' : '发送'}
          </button>
        </div>
      </form>
    </PanelCard>
  )
}