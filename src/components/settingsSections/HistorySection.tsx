import { memo, useEffect, useMemo, useState } from 'react'
import { loadChatSessions, removeChatSession, type ChatSession } from '../../lib'
import {
  isChatLocalDataAuthorityActive,
  readChatSessionsFromLocalData,
} from '../../lib/storage'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { ConfirmFn } from '../useConfirm.ts'
import type { UiLanguage } from '../../types'
import { ChatMigrationPreviewPanel } from './ChatMigrationPreviewPanel.tsx'

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
  confirm: ConfirmFn
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
  confirm,
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
  const chatAuthorityActive = isChatLocalDataAuthorityActive()
  const [authoritativeSessions, setAuthoritativeSessions] = useState<ChatSession[] | null>(null)

  useEffect(() => {
    if (!active || !chatAuthorityActive) {
      setAuthoritativeSessions(null)
      return
    }

    let cancelled = false
    setAuthoritativeSessions(null)
    void readChatSessionsFromLocalData().then(({ sessions }) => {
      if (cancelled || !sessions) return
      setAuthoritativeSessions(sessions as ChatSession[])
    })
    return () => {
      cancelled = true
    }
  }, [active, chatAuthorityActive, chatMessageCount, refreshKey])

  const sessions = useMemo<ChatSession[]>(
    () => {
      if (!active) return []
      if (chatAuthorityActive && authoritativeSessions) return authoritativeSessions
      return loadChatSessions()
    },
    // chatMessageCount + refreshKey are invalidation keys — the memo body
    // doesn't read them, but they must trigger a fresh loadChatSessions()
    // when the active session grows or a destructive action fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, authoritativeSessions, chatAuthorityActive, chatMessageCount, refreshKey],
  )

  const archivedSessions = useMemo(
    () => sessions.filter((session) => session.id !== currentSessionId),
    [sessions, currentSessionId],
  )

  const handleRemove = async (id: string) => {
    if (!(await confirm({ message: ti('settings.history.delete_confirm'), tone: 'danger' }))) return
    removeChatSession(id)
    if (chatAuthorityActive) {
      const session = sessions.find((item) => item.id === id)
      if (session) {
        void window.desktopPet?.localDataMirrorChatSession({
          confirmed: true,
          session: { ...session, messages: [] },
        })
      }
    }
    setRefreshKey((v) => v + 1)
    if (expandedId === id) setExpandedId(null)
  }

  return (
    <section className={`settings-section settings-history-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-mini-group settings-history-group">
        <div className="settings-control-grid settings-history-summary-grid">
          <div className="settings-metric-card">
            <span>{ti('settings.history.message_count')}</span>
            <strong>{chatMessageCount}</strong>
          </div>

          <div className="settings-metric-card">
            <span>{ti('settings.history.current_status')}</span>
            <strong>{chatBusy ? ti('settings.history.replying') : ti('settings.history.idle')}</strong>
          </div>
        </div>

        <p className="settings-mini-group__note settings-history-note">
          {ti('settings.history.hint')}
        </p>

        <div className="settings-action-row settings-history-actions">
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
            className="settings-danger-button settings-history-clear-button"
            onClick={onClearChatHistory}
            disabled={clearingChatHistory || chatBusy || !chatMessageCount}
          >
            {clearingChatHistory
              ? ti('settings.history.clearing')
              : ti('settings.history.clear')}
          </button>
        </div>

        {chatHistoryStatus ? (
          <div
            className={chatHistoryStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}
            role={chatHistoryStatus.ok ? 'status' : 'alert'}
            aria-live={chatHistoryStatus.ok ? 'polite' : 'assertive'}
            aria-atomic="true"
          >
            {chatHistoryStatus.message}
          </div>
        ) : null}
      </div>

      <ChatMigrationPreviewPanel
        uiLanguage={uiLanguage}
        confirm={confirm}
      />

      <div className="settings-mini-group settings-history-group">
        <div className="settings-mini-group__head settings-history-group__head">
          <h5>{ti('settings.history.archived_title')}</h5>
          <span>
            {ti('settings.history.archived_note')}
          </span>
        </div>

        {archivedSessions.length === 0 ? (
          <p className="settings-history-empty">{ti('settings.history.archived_empty')}</p>
        ) : (
          <ul className="settings-history-list">
            {archivedSessions.map((session) => {
              const isExpanded = expandedId === session.id
              const sessionTitle = session.title ?? ti('settings.history.untitled_session')
              const messagesId = `settings-history-messages-${encodeURIComponent(session.id)}`
              const expandLabel = `${isExpanded ? ti('settings.history.collapse') : ti('settings.history.expand')}: ${sessionTitle}`
              const deleteLabel = `${ti('settings.history.delete')}: ${sessionTitle}`

              return (
                <li
                  key={session.id}
                  className="settings-history-item"
                >
                  <div className="settings-history-item__header">
                    <div className="settings-history-item__main">
                      <div className="settings-history-item__title">
                        {sessionTitle}
                      </div>
                      <div className="settings-history-item__meta">
                        {formatTimestamp(session.lastActiveAt)} · {session.messages.length} {ti('settings.history.message_count_suffix')}
                      </div>
                    </div>
                    <div className="settings-history-item__actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setExpandedId(isExpanded ? null : session.id)}
                        aria-expanded={isExpanded}
                        aria-controls={messagesId}
                        aria-label={expandLabel}
                        title={expandLabel}
                      >
                        {isExpanded ? ti('settings.history.collapse') : ti('settings.history.expand')}
                      </button>
                      <button
                        type="button"
                        className="ghost-button settings-history-item__delete"
                        onClick={() => handleRemove(session.id)}
                        aria-label={deleteLabel}
                        title={deleteLabel}
                      >
                        {ti('settings.history.delete')}
                      </button>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div id={messagesId} className="settings-history-messages">
                      {session.messages.length === 0 ? (
                        <div className="settings-history-messages__empty">{ti('settings.history.empty_messages')}</div>
                      ) : (
                        session.messages.map((msg) => (
                          <div key={msg.id} className="settings-history-message">
                            <span className="settings-history-message__role">
                              {msg.role === 'user'
                                ? ti('settings.history.role.user')
                                : msg.role === 'assistant'
                                  ? ti('settings.history.role.assistant')
                                  : msg.role}
                            </span>
                            <span className="settings-history-message__content">{msg.content}</span>
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
      </div>
    </section>
  )
})
