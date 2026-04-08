import type { WorkspaceMessage } from '@ai-repo-assistant/shared'

import { PanelCard } from './PanelCard'

type ChatPanelProps = {
  messages: WorkspaceMessage[]
  draftMessage: string
  selectedContextPaths: string[]
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

export function ChatPanel({
  messages,
  draftMessage,
  selectedContextPaths,
  isSendingMessage,
  onDraftChange,
  onSend,
}: ChatPanelProps) {
  const canSend = draftMessage.trim().length > 0 && !isSendingMessage

  return (
    <PanelCard
      title="Conversation"
      subtitle="Ask a repo question or request a mock code change."
      actions={<span className="context-count">{selectedContextPaths.length} file(s) selected</span>}
    >
      {/* 这里是消息历史区。 */}
      <div className="chat-messages">
        {messages.map((message) => (
          <article key={message.id} className={`message message--${message.role}`}>
            <div className="message__meta">
              <strong>{message.role === 'assistant' ? 'AI 助手' : '我'}</strong>
              <span>{formatMessageTime(message.createdAt)}</span>
            </div>
            <p>{message.content}</p>
          </article>
        ))}
      </div>

      {/* 这里把当前选中的上下文文件显式展示出来，方便用户知道 AI 看了哪些文件。 */}
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
          <p>Day 1 uses mocked repo answers and mocked diff suggestions.</p>
          <button disabled={!canSend} type="submit">
            {isSendingMessage ? '思考中...' : '发送'}
          </button>
        </div>
      </form>
    </PanelCard>
  )
}
