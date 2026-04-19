import { memo, useMemo, useState } from 'react'
import { loadChatSessions, removeChatSession, type ChatSession } from '../../lib'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'

type StatusMessage = {
  ok: boolean
  message: string
} | null

type HistorySectionProps = {
  active: boolean
  uiLanguage: UiLanguage
  chatMessageCount: number
  chatBusy: boolean
  exportingChatHistory: boolean
  importingChatHistory: boolean
  clearingChatHistory: boolean
  chatHistoryStatus: StatusMessage
  currentSessionId?: string
  onExportChatHistory: () => void
  onImportChatHistory: () => void
  onClearChatHistory: () => void
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

export const HistorySection = memo(function HistorySection({
  active,
  uiLanguage,
  chatMessageCount,
  chatBusy,
  exportingChatHistory,
  importingChatHistory,
  clearingChatHistory,
  chatHistoryStatus,
  currentSessionId,
  onExportChatHistory,
  onImportChatHistory,
  onClearChatHistory,
}: HistorySectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Monotonic counter that forces a re-read of the sessions store after
  // destructive actions (delete). Paired with `active` + `chatMessageCount`
  // in the useMemo deps so sessions refresh when the panel opens or the
  // active session grows.
  const [refreshKey, setRefreshKey] = useState(0)

  const sessions = useMemo<ChatSession[]>(
    () => (active ? loadChatSessions() : []),
    // chatMessageCount + refreshKey are invalidation keys — the memo body
    // doesn't read them, but they must trigger a fresh loadChatSessions()
    // when the active session grows or a destructive action fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, chatMessageCount, refreshKey],
  )

  const archivedSessions = useMemo(
    () => sessions.filter((session) => session.id !== currentSessionId),
    [sessions, currentSessionId],
  )

  const handleRemove = (id: string) => {
    removeChatSession(id)
    setRefreshKey((v) => v + 1)
    if (expandedId === id) setExpandedId(null)
  }

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.history.title')}</h4>
          <p className="settings-drawer__hint">
            {ti('settings.history.note')}
          </p>
        </div>
      </div>

      <div className="settings-grid">
        <label>
          <span>{ti('settings.history.message_count')}</span>
          <input value={String(chatMessageCount)} readOnly />
        </label>

        <label>
          <span>{ti('settings.history.current_status')}</span>
          <input
            value={chatBusy ? ti('settings.history.replying') : ti('settings.history.idle')}
            readOnly
          />
        </label>
      </div>

      <p className="settings-drawer__hint">
        {ti('settings.history.hint')}
      </p>

      <div className="settings-section__title-row">
        <button
          type="button"
          className="ghost-button"
          onClick={onExportChatHistory}
          disabled={exportingChatHistory}
        >
          {exportingChatHistory
            ? ti('settings.history.exporting')
            : ti('settings.history.export')}
        </button>

        <button
          type="button"
          className="ghost-button"
          onClick={onImportChatHistory}
          disabled={importingChatHistory || chatBusy}
        >
          {importingChatHistory
            ? ti('settings.history.importing')
            : ti('settings.history.import')}
        </button>

        <button
          type="button"
          className="ghost-button"
          onClick={onClearChatHistory}
          disabled={clearingChatHistory || chatBusy || !chatMessageCount}
        >
          {clearingChatHistory
            ? ti('settings.history.clearing')
            : ti('settings.history.clear')}
        </button>
      </div>

      {chatHistoryStatus ? (
        <div className={chatHistoryStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}>
          {chatHistoryStatus.message}
        </div>
      ) : null}

      <div className="settings-section__title-row" style={{ marginTop: 24 }}>
        <div>
          <h4>往期会话</h4>
          <p className="settings-drawer__hint">
            每次启动 Nexus 会开启新的对话面板，往期对话保留在此——点击展开查看。
          </p>
        </div>
      </div>

      {archivedSessions.length === 0 ? (
        <p className="settings-drawer__hint">（暂无往期会话）</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {archivedSessions.map((session) => {
            const isExpanded = expandedId === session.id
            return (
              <li
                key={session.id}
                style={{
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.title ?? '（无标题会话）'}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.65 }}>
                      {formatTimestamp(session.lastActiveAt)} · {session.messages.length} 条
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setExpandedId(isExpanded ? null : session.id)}
                  >
                    {isExpanded ? '收起' : '展开'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => handleRemove(session.id)}
                  >
                    删除
                  </button>
                </div>

                {isExpanded ? (
                  <div
                    style={{
                      maxHeight: 320,
                      overflowY: 'auto',
                      padding: 8,
                      background: 'var(--surface-sunken, rgba(0,0,0,0.15))',
                      borderRadius: 6,
                      fontSize: 13,
                      lineHeight: 1.5,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    {session.messages.length === 0 ? (
                      <div style={{ opacity: 0.5 }}>（此会话没有消息）</div>
                    ) : (
                      session.messages.map((msg) => (
                        <div key={msg.id}>
                          <span style={{ opacity: 0.6, marginRight: 6 }}>
                            {msg.role === 'user' ? '你' : msg.role === 'assistant' ? '伙伴' : msg.role}
                          </span>
                          <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
})
