import { useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useBoard } from '../state/BoardContext'
import { useClickOutside } from '../hooks/useClickOutside'
import { uid } from '../utils'

interface AddCardComposerProps {
  columnId: string
  /** 카드를 컬럼의 어느 쪽에 추가할지 (기본: 맨 아래) */
  at?: 'start' | 'end'
  /** 카드 추가 직후 새 카드 id와 함께 호출 */
  onAdded?: (cardId: string) => void
  /** 제어 모드: 열림 상태를 부모가 관리 (트리거 버튼 없이 렌더링) */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function AddCardComposer({ columnId, at = 'end', onAdded, open: openProp, onOpenChange }: AddCardComposerProps) {
  const { dispatch } = useBoard()
  const isControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? openProp : internalOpen
  const [title, setTitle] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)

  function setOpen(next: boolean) {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }

  function addCard(trimmedTitle: string) {
    const cardId = uid()
    dispatch({
      type: 'ADD_CARD',
      columnId,
      at,
      card: {
        id: cardId,
        title: trimmedTitle,
        description: '',
        labelIds: [],
        assignee: '',
        dueDate: null,
        createdAt: new Date().toISOString(),
      },
    })
    onAdded?.(cardId)
  }

  function submit() {
    const trimmed = title.trim()
    if (trimmed) addCard(trimmed)
    // 연속 입력을 위해 composer는 열어둔 채 내용만 비움
    setTitle('')
    textareaRef.current?.focus()
  }

  // Trello 관례: 바깥을 클릭하면 입력 중이던 제목은 카드로 저장하고 composer를 닫는다.
  // 다른 컬럼의 '카드 추가'를 누르면 이 composer가 닫혀 한 번에 하나만 열린 상태가 유지된다.
  // 'click' 시점 사용: pointerdown에 닫으면 카드 드래그 시작 직전에 레이아웃이 변형되어
  // 드래그 오버레이가 composer 높이만큼 어긋난다.
  useClickOutside(
    composerRef,
    open,
    () => {
      const trimmed = title.trim()
      if (trimmed) addCard(trimmed)
      setTitle('')
      setOpen(false)
    },
    'click',
  )

  if (!open) {
    if (isControlled) return null
    return (
      <button className="add-card-btn" onClick={() => setOpen(true)}>
        <Plus size={16} />
        카드 추가
      </button>
    )
  }

  return (
    <div className="card-composer" ref={composerRef}>
      <textarea
        ref={textareaRef}
        autoFocus
        rows={2}
        placeholder="카드 제목을 입력하세요"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          // 한글 IME 조합 중 Enter/Esc는 조합 확정/취소이므로 무시
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            // 카드 제목은 한 줄 — Shift+Enter(줄바꿈 관례)는 제출도 줄바꿈도 하지 않음
            e.preventDefault()
            if (!e.shiftKey) submit()
          } else if (e.key === 'Escape') {
            setOpen(false)
            setTitle('')
          }
        }}
      />
      <div className="composer-actions">
        <button className="btn btn-primary" onClick={submit} disabled={!title.trim()}>
          추가
        </button>
        <button
          className="btn btn-icon"
          aria-label="닫기"
          onClick={() => {
            setOpen(false)
            setTitle('')
          }}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
