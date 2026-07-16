import { memo, useEffect, useMemo, useState } from 'react'
import { PetControlIcon } from '../../components/PetControlIcon'
import type { ConfirmFn } from '../../components/useConfirm'
import { loadChatSessions, removeChatSession, type ChatSession } from '../../lib'
import {
  isChatLocalDataAuthorityActive,
  readChatSessionsFromLocalData,
} from '../../lib/storage'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'
import {
  SettingsV3Empty,
  SettingsV3Notice,
  SettingsV3Page,
  SettingsV3Row,
  SettingsV3Section,
  SettingsV3Toolbar,
} from './SettingsV3Primitives'
import './settings-v3-collection.css'

export type HistorySectionV3Status = {
  ok: boolean
  message: string
} | null

export type HistorySectionV3Props = {
  active: boolean
  uiLanguage: UiLanguage
  chatMessageCount: number
  chatBusy: boolean
  exportingChatHistory: boolean
  importingChatHistory: boolean
  clearingChatHistory: boolean
  chatHistoryStatus: HistorySectionV3Status
  currentSessionId?: string
  confirm: ConfirmFn
  onExportChatHistory: () => void
  onImportChatHistory: () => void
  onClearChatHistory: () => void
}

function formatTimestamp(timestamp: number, uiLanguage: UiLanguage): string {
  if (!Number.isFinite(timestamp)) return ''
  return new Intl.DateTimeFormat(uiLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export const HistorySectionV3 = memo(function HistorySectionV3({
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
}: HistorySectionV3Props) {
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
  ) => pickTranslatedUiText(uiLanguage, key)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const chatAuthorityActive = isChatLocalDataAuthorityActive()
  const [authoritativeSessions, setAuthoritativeSessions] = useState<ChatSession[] | null>(null)

  useEffect(() => {
    if (!active || !chatAuthorityActive) {
      setAuthoritativeSessions(null)
      return undefined
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

  const sessions = useMemo<ChatSession[]>(() => {
    if (!active) return []
    if (chatAuthorityActive && authoritativeSessions) return authoritativeSessions
    return loadChatSessions()
    // chatMessageCount and refreshKey deliberately invalidate the local store read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, authoritativeSessions, chatAuthorityActive, chatMessageCount, refreshKey])

  const archivedSessions = useMemo(
    () => sessions.filter((session) => session.id !== currentSessionId),
    [sessions, currentSessionId],
  )

  const handleRemove = async (session: ChatSession) => {
    const accepted = await confirm({
      message: ti('settings.history.delete_confirm'),
      tone: 'danger',
    })
    if (!accepted) return

    removeChatSession(session.id)
    if (chatAuthorityActive) {
      void window.desktopPet?.localDataMirrorChatSession({
        confirmed: true,
        session: { ...session, messages: [] },
      })
    }
    setRefreshKey((value) => value + 1)
    setExpandedId((value) => value === session.id ? null : value)
  }

  return (
    <SettingsV3Page className={active ? 'settings-v3-history' : 'settings-v3-history is-hidden'}>
      <SettingsV3Section title={ti('settings.section.history')} hideHeader>
        <SettingsV3Row
          icon="chat"
          label={ti('settings.history.message_count')}
          meta={chatMessageCount.toLocaleString(uiLanguage)}
        />
        <SettingsV3Row
          icon="continuous"
          label={ti('settings.history.current_status')}
          meta={chatBusy ? ti('settings.history.replying') : ti('settings.history.idle')}
        />
        <SettingsV3Row
          icon="clipboard"
          label={ti('settings.history.archived_title')}
          meta={archivedSessions.length.toLocaleString(uiLanguage)}
        />
      </SettingsV3Section>

      <SettingsV3Section
        title={ti('settings.history.export')}
        description={ti('settings.history.hint')}
      >
        <div className="settings-v3-editor">
          <SettingsV3Toolbar>
            <button
              type="button"
              onClick={onExportChatHistory}
              disabled={exportingChatHistory}
            >
              {exportingChatHistory
                ? ti('settings.history.exporting')
                : ti('settings.history.export')}
            </button>
            <button
              type="button"
              onClick={onImportChatHistory}
              disabled={importingChatHistory || chatBusy}
            >
              {importingChatHistory
                ? ti('settings.history.importing')
                : ti('settings.history.import')}
            </button>
          </SettingsV3Toolbar>
        </div>
      </SettingsV3Section>

      {chatHistoryStatus ? (
        <SettingsV3Notice
          tone={chatHistoryStatus.ok ? 'success' : 'error'}
          title={chatHistoryStatus.message}
          announce
        />
      ) : null}

      <SettingsV3Section
        title={ti('settings.history.archived_title')}
        description={ti('settings.history.archived_note')}
      >
        {archivedSessions.length === 0 ? (
          <SettingsV3Empty title={ti('settings.history.archived_empty')} />
        ) : (
          <ul className="settings-v3-collection" aria-label={ti('settings.history.archived_title')}>
            {archivedSessions.map((session) => {
              const expanded = expandedId === session.id
              const title = session.title ?? ti('settings.history.untitled_session')
              const transcriptId = `settings-v3-history-${encodeURIComponent(session.id)}`
              const toggleLabel = `${expanded
                ? ti('settings.history.collapse')
                : ti('settings.history.expand')}: ${title}`
              const deleteLabel = `${ti('settings.history.delete')}: ${title}`

              return (
                <li key={session.id} className="settings-v3-collection-row">
                  <button
                    type="button"
                    className="settings-v3-collection-row__main"
                    aria-expanded={expanded}
                    aria-controls={transcriptId}
                    onClick={() => setExpandedId(expanded ? null : session.id)}
                  >
                    <span className="settings-v3-collection-row__title">{title}</span>
                    <span className="settings-v3-collection-row__preview">
                      {session.messages.at(-1)?.content || ti('settings.history.empty_messages')}
                    </span>
                    <span className="settings-v3-collection-row__meta">
                      {formatTimestamp(session.lastActiveAt, uiLanguage)} · {session.messages.length}{' '}
                      {ti('settings.history.message_count_suffix')}
                    </span>
                  </button>

                  <SettingsV3Toolbar>
                    <button
                      type="button"
                      aria-label={toggleLabel}
                      title={toggleLabel}
                      aria-expanded={expanded}
                      aria-controls={transcriptId}
                      onClick={() => setExpandedId(expanded ? null : session.id)}
                    >
                      <PetControlIcon name={expanded ? 'collapse' : 'expand'} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      aria-label={deleteLabel}
                      title={deleteLabel}
                      onClick={() => void handleRemove(session)}
                    >
                      <PetControlIcon name="trash" aria-hidden="true" />
                    </button>
                  </SettingsV3Toolbar>

                  {expanded ? (
                    <div
                      id={transcriptId}
                      style={{
                        gridColumn: '1 / -1',
                        overflow: 'hidden',
                        borderTop: '1px solid var(--sv3-line)',
                        borderRadius: '10px',
                      }}
                    >
                      {session.messages.length === 0 ? (
                        <SettingsV3Empty title={ti('settings.history.empty_messages')} />
                      ) : (
                        session.messages.map((message) => (
                          <SettingsV3Row
                            key={message.id}
                            label={message.role === 'user'
                              ? ti('settings.history.role.user')
                              : message.role === 'assistant'
                                ? ti('settings.history.role.assistant')
                                : message.role}
                            hint={message.content}
                          />
                        ))
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </SettingsV3Section>

      <SettingsV3Section
        title={ti('settings.history.clear')}
        description={ti('settings.chat_history.clear_confirm')}
      >
        <div className="settings-v3-editor">
          <SettingsV3Toolbar>
            <button
              type="button"
              className="is-danger"
              onClick={onClearChatHistory}
              disabled={clearingChatHistory || chatBusy || !chatMessageCount}
            >
              {clearingChatHistory
                ? ti('settings.history.clearing')
                : ti('settings.history.clear')}
            </button>
          </SettingsV3Toolbar>
        </div>
      </SettingsV3Section>
    </SettingsV3Page>
  )
})
