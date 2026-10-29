/**
 * Gentle "she wrote you a letter" card shown above the V2 chat history.
 * Pure presentation: the host decides which letter is unread and what
 * happens when the card opens.
 */

export interface SundayLetterNotice {
  title: string
  dateLabel: string
  preview: string
  actionLabel: string
}

export function SundayLetterCard({ notice, onOpen }: {
  notice: SundayLetterNotice
  onOpen: () => void
}) {
  return (
    <aside className="chat-sheet-v2__letter" aria-label={notice.title}>
      <div className="chat-sheet-v2__letter-copy">
        <div className="chat-sheet-v2__letter-meta">
          <span className="chat-sheet-v2__letter-title">{notice.title}</span>
          <span className="chat-sheet-v2__letter-date">{notice.dateLabel}</span>
        </div>
        <p className="chat-sheet-v2__letter-preview">{notice.preview}</p>
      </div>
      <button type="button" className="chat-sheet-v2__letter-open" onClick={onOpen}>
        {notice.actionLabel}
      </button>
    </aside>
  )
}
