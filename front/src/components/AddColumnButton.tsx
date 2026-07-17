import { useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useBoard } from '../state/BoardContext'
import { useClickOutside } from '../hooks/useClickOutside'
import { uid } from '../utils'

export function AddColumnButton() {
  const { dispatch } = useBoard()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const composerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function addColumn(): boolean {
    const trimmed = title.trim()
    if (!trimmed) return false
    dispatch({ type: 'ADD_COLUMN', column: { id: uid(), title: trimmed, cardIds: [] } })
    return true
  }

  // 카드 composer와 동일한 연속 입력 패턴: 추가 후에도 열어두고 포커스 유지.
  // 새 컬럼이 앞에 끼어들며 composer가 화면 밖으로 밀리지 않도록 스크롤을 따라간다.
  function submit() {
    addColumn()
    setTitle('')
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      inputRef.current?.focus()
    })
  }

  // 바깥 클릭 시 입력 중이던 이름이 있으면 컬럼으로 저장하고 닫는다
  useClickOutside(
    composerRef,
    open,
    () => {
      addColumn()
      setTitle('')
      setOpen(false)
    },
    'click',
  )

  if (!open) {
    return (
      <button className="add-column-btn" onClick={() => setOpen(true)}>
        <Plus size={16} />
        컬럼 추가
      </button>
    )
  }

  return (
    <div className="column-composer" ref={composerRef}>
      <input
        ref={inputRef}
        autoFocus
        placeholder="컬럼 이름을 입력하세요"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') submit()
          else if (e.key === 'Escape') {
            setTitle('')
            setOpen(false)
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
            setTitle('')
            setOpen(false)
          }}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
