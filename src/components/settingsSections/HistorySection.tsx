import { memo } from 'react'

type StatusMessage = {
  ok: boolean
  message: string
} | null

type HistorySectionProps = {
  active: boolean
  chatMessageCount: number
  chatBusy: boolean
  exportingChatHistory: boolean
  importingChatHistory: boolean
  clearingChatHistory: boolean
  chatHistoryStatus: StatusMessage
  onExportChatHistory: () => void
  onImportChatHistory: () => void
  onClearChatHistory: () => void
}

export const HistorySection = memo(function HistorySection({
  active,
  chatMessageCount,
  chatBusy,
  exportingChatHistory,
  importingChatHistory,
  clearingChatHistory,
  chatHistoryStatus,
  onExportChatHistory,
  onImportChatHistory,
  onClearChatHistory,
}: HistorySectionProps) {
  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>聊天记录</h4>
          <p className="settings-drawer__hint">
            这里管理当前会话的导出、导入和清空，不会改动长期记忆。
          </p>
        </div>
      </div>

      <div className="settings-grid">
        <label>
          <span>当前消息数</span>
          <input value={String(chatMessageCount)} readOnly />
        </label>

        <label>
          <span>当前状态</span>
          <input value={chatBusy ? '回复处理中' : '待机'} readOnly />
        </label>
      </div>

      <p className="settings-drawer__hint">
        导入会替换当前聊天记录；导出文件为 JSON，后面也可以作为多会话功能的基础。
      </p>

      <div className="settings-section__title-row">
        <button
          type="button"
          className="ghost-button"
          onClick={onExportChatHistory}
          disabled={exportingChatHistory}
        >
          {exportingChatHistory ? '导出中...' : '导出聊天 JSON'}
        </button>

        <button
          type="button"
          className="ghost-button"
          onClick={onImportChatHistory}
          disabled={importingChatHistory || chatBusy}
        >
          {importingChatHistory ? '导入中...' : '导入聊天 JSON'}
        </button>

        <button
          type="button"
          className="ghost-button"
          onClick={onClearChatHistory}
          disabled={clearingChatHistory || chatBusy || !chatMessageCount}
        >
          {clearingChatHistory ? '清空中...' : '清空当前聊天'}
        </button>
      </div>

      {chatHistoryStatus ? (
        <div className={chatHistoryStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}>
          {chatHistoryStatus.message}
        </div>
      ) : null}
    </section>
  )
})
