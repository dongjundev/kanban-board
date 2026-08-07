import { useRef, useState } from 'react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ListStart, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Card, Column as ColumnType } from '../types'
import { useBoard } from '../state/BoardContext'
import { labelsOf } from '../utils'
import { useClickOutside } from '../hooks/useClickOutside'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { useConfirm } from './ConfirmDialog'
import { CardItem } from './CardItem'
import { AddCardComposer } from './AddCardComposer'

interface ColumnProps {
  column: ColumnType
  /** 필터 적용 후 보이는 카드들 (컬럼 내 순서 유지) */
  visibleCards: Card[]
  onCardClick: (cardId: string) => void
  onCardAdded: (cardId: string) => void
}

/**
 * 컬럼 헤더에 스프레드된 dnd 센서 리스너(mouse/touch/pointer)가 내부 컨트롤
 * (이름 입력, ⋯ 메뉴) 조작을 컬럼 드래그 시작으로 오인하지 않도록 버블 차단.
 * 세 이벤트 모두 필요 — 센서별로 듣는 이벤트가 다르다 (Mouse=mousedown, Touch=touchstart).
 */
const stopEvent = (e: { stopPropagation: () => void }) => e.stopPropagation()
const stopDndSensorEvents = {
  onPointerDown: stopEvent,
  onMouseDown: stopEvent,
  onTouchStart: stopEvent,
}

export function Column({ column, visibleCards, onCardClick, onCardAdded }: ColumnProps) {
  const { state, dispatch } = useBoard()
  const undoableDelete = useUndoableDelete()
  const { confirm } = useConfirm()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(column.title)
  const [menuOpen, setMenuOpen] = useState(false)
  const [topComposerOpen, setTopComposerOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  /** 스크롤된 긴 컬럼에서 새 카드가 화면 밖에 추가되어 안 보이는 문제 방지 */
  function scrollToBottom() {
    requestAnimationFrame(() => {
      const body = bodyRef.current
      if (body) body.scrollTop = body.scrollHeight
    })
  }

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'column' },
  })

  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false))

  function commitRename() {
    setEditing(false)
    if (draft.trim() && draft.trim() !== column.title) {
      dispatch({ type: 'RENAME_COLUMN', columnId: column.id, title: draft })
    } else {
      setDraft(column.title)
    }
  }

  async function deleteColumn() {
    const count = column.cardIds.length
    const message =
      count > 0 ? `'${column.title}' 컬럼과 카드 ${count}개를 삭제할까요?` : `'${column.title}' 컬럼을 삭제할까요?`
    if (await confirm({ message })) {
      undoableDelete({ type: 'DELETE_COLUMN', columnId: column.id }, `'${column.title}' 컬럼을 삭제했습니다`)
    }
  }

  return (
    <section
      ref={setNodeRef}
      className={`column${isDragging ? ' column-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <header className="column-header" {...attributes} {...listeners}>
        {editing ? (
          <input
            className="column-title-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              // 헤더의 KeyboardSensor(드래그 시작)가 Space/Enter를 가로채지 않도록 차단
              e.stopPropagation()
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') commitRename()
              else if (e.key === 'Escape') {
                setDraft(column.title)
                setEditing(false)
              }
            }}
            {...stopDndSensorEvents}
          />
        ) : (
          <h2
            className="column-title"
            title="클릭해서 이름 바꾸기"
            role="button"
            tabIndex={0}
            onClick={() => {
              setDraft(column.title)
              setEditing(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                setDraft(column.title)
                setEditing(true)
              }
            }}
          >
            {column.title}
          </h2>
        )}
        <span className="column-count">{visibleCards.length}</span>
        {/* onKeyDown이 키를 밖으로 내보내지 않으므로 Esc도 여기서 처리해야 한다 —
            다른 팝오버(BoardSwitcher·LabelPicker)와 같은 규약을 맞춘다 */}
        <div
          className="column-menu"
          ref={menuRef}
          {...stopDndSensorEvents}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing && menuOpen) setMenuOpen(false)
            stopEvent(e)
          }}
        >
          <button className="btn btn-icon" aria-label="컬럼 메뉴" onClick={() => setMenuOpen((v) => !v)}>
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <div className="menu-popover">
              <button
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  setDraft(column.title)
                  setEditing(true)
                }}
              >
                <Pencil size={14} />
                이름 바꾸기
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  setTopComposerOpen(true)
                }}
              >
                <ListStart size={14} />
                맨 위에 카드 추가
              </button>
              <button
                className="menu-item menu-item-danger"
                onClick={() => {
                  setMenuOpen(false)
                  deleteColumn()
                }}
              >
                <Trash2 size={14} />
                컬럼 삭제
              </button>
            </div>
          )}
        </div>
      </header>

      <SortableContext items={visibleCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="column-body" ref={bodyRef}>
          {topComposerOpen && (
            <AddCardComposer
              columnId={column.id}
              at="start"
              open
              onOpenChange={setTopComposerOpen}
              onAdded={(cardId) => {
                onCardAdded(cardId)
                requestAnimationFrame(() => {
                  if (bodyRef.current) bodyRef.current.scrollTop = 0
                })
              }}
            />
          )}
          {visibleCards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              labels={labelsOf(card, state.labels)}
              onClick={() => onCardClick(card.id)}
            />
          ))}
        </div>
      </SortableContext>

      <footer className="column-footer">
        <AddCardComposer
          columnId={column.id}
          onAdded={(cardId) => {
            onCardAdded(cardId)
            scrollToBottom()
          }}
        />
      </footer>
    </section>
  )
}
