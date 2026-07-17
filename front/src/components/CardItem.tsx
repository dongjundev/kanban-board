import type { KeyboardEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlignLeft, CircleAlert, Clock } from 'lucide-react'
import type { Card, Label } from '../types'
import { dueStatus, formatDueDate } from '../utils'
import { Avatar } from './Avatar'

const DUE_STATUS_TEXT = { overdue: '마감일 지남', soon: '마감 임박', normal: '마감일' } as const

interface CardItemProps {
  card: Card
  labels: Label[]
  onClick: () => void
}

function CardContent({ card, labels }: { card: Card; labels: Label[] }) {
  const status = card.dueDate ? dueStatus(card.dueDate) : null
  const dueText = card.dueDate && status ? `${DUE_STATUS_TEXT[status]} — ${formatDueDate(card.dueDate)}` : ''
  return (
    <>
      {labels.length > 0 && (
        <div className="card-labels">
          {labels.map((label) => (
            <span key={label.id} className="card-label" style={{ background: label.color }}>
              {label.name}
            </span>
          ))}
        </div>
      )}
      <div className="card-title">{card.title}</div>
      {(card.dueDate || card.assignee || card.description) && (
        <div className="card-footer">
          <span className="card-footer-meta">
            {card.dueDate && status && (
              <span className={`due-pill due-${status}`} title={dueText} aria-label={dueText}>
                {status === 'overdue' ? <CircleAlert size={12} /> : <Clock size={12} />}
                {formatDueDate(card.dueDate)}
              </span>
            )}
            {card.description && (
              <span className="card-desc-icon" title="설명 있음" aria-label="설명 있음">
                <AlignLeft size={13} />
              </span>
            )}
          </span>
          {card.assignee && <Avatar name={card.assignee} />}
        </div>
      )}
    </>
  )
}

export function CardItem({ card, labels, onClick }: CardItemProps) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card' },
  })

  // listeners의 onKeyDown(KeyboardSensor)은 Enter/Space를 모두 드래그 시작으로 소비한다.
  // Enter는 카드 상세 열기(버튼 시맨틱), Space는 센서에 위임해 키보드 드래그를 유지한다.
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && !isDragging) {
      e.preventDefault()
      onClick()
      return
    }
    listeners?.onKeyDown?.(e)
  }

  return (
    <div
      ref={setNodeRef}
      className={`card${isDragging ? ' card-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onClick}
      {...attributes}
      {...listeners}
      onKeyDown={handleKeyDown}
    >
      <CardContent card={card} labels={labels} />
    </div>
  )
}

/** DragOverlay 전용 — sortable 훅 없이 카드 모양만 렌더링 */
export function CardOverlay({ card, labels }: { card: Card; labels: Label[] }) {
  return (
    <div className="card card-overlay">
      <CardContent card={card} labels={labels} />
    </div>
  )
}
