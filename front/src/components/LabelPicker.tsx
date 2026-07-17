import { useEffect, useRef, useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import type { Card } from '../types'
import { LABEL_COLORS } from '../types'
import { useBoard } from '../state/BoardContext'
import { useClickOutside } from '../hooks/useClickOutside'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { useConfirm } from './ConfirmDialog'
import { labelsOf, uid } from '../utils'

export function LabelPicker({ card }: { card: Card }) {
  const { state, dispatch } = useBoard()
  const undoableDelete = useUndoableDelete()
  const { confirm } = useConfirm()
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<string>(LABEL_COLORS[0])
  // 편집 중인 라벨 (인라인 이름/색 수정)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState<string>(LABEL_COLORS[0])
  const popoverRef = useRef<HTMLDivElement>(null)

  useClickOutside(popoverRef, open, () => {
    setOpen(false)
    setEditingId(null)
  })

  const assigned = labelsOf(card, state.labels)
  const allLabels = Object.values(state.labels)

  function toggle(labelId: string) {
    const labelIds = card.labelIds.includes(labelId)
      ? card.labelIds.filter((id) => id !== labelId)
      : [...card.labelIds, labelId]
    dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch: { labelIds } })
  }

  function createLabel() {
    const name = newName.trim()
    if (!name) return
    const label = { id: uid(), name, color: newColor }
    dispatch({ type: 'ADD_LABEL', label })
    dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch: { labelIds: [...card.labelIds, label.id] } })
    setNewName('')
  }

  function startEdit(labelId: string) {
    const label = state.labels[labelId]
    if (!label) return
    setEditingId(labelId)
    setEditName(label.name)
    setEditColor(label.color)
  }

  function commitEdit() {
    if (editingId && editName.trim()) {
      dispatch({ type: 'UPDATE_LABEL', labelId: editingId, patch: { name: editName, color: editColor } })
    }
    setEditingId(null)
  }

  async function deleteLabel(labelId: string, name: string) {
    const usedCount = Object.values(state.cards).filter((c) => c.labelIds.includes(labelId)).length
    const scale = usedCount > 0 ? `\n카드 ${usedCount}개에서 제거됩니다.` : ''
    if (await confirm({ message: `'${name}' 라벨을 삭제할까요?${scale}` })) {
      undoableDelete({ type: 'DELETE_LABEL', labelId }, `'${name}' 라벨을 삭제했습니다`)
    }
  }

  // Esc는 최상위 레이어만 닫는다: 편집 폼 → 팝오버 → (그 다음에야) 모달.
  // 저장/취소 후 포커스가 body로 떨어져도 잡히도록, 팝오버가 열린 동안
  // document 캡처 단계에서 가로채 CardModal의 Esc 핸들러(모달 닫기)로 새지 않게 한다.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: globalThis.KeyboardEvent) {
      // confirm 다이얼로그가 떠 있으면 그쪽이 최상위 레이어 — Esc를 양보한다.
      // (둘 다 document 캡처 리스너라 stopPropagation으로는 서로를 막지 못함)
      if (document.querySelector('.confirm-backdrop')) return
      if (e.key === 'Escape' && !e.isComposing) {
        e.stopPropagation()
        if (editingId) setEditingId(null)
        else setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, editingId])

  return (
    <div className="label-picker" ref={popoverRef}>
      <div className="label-pills">
        {assigned.map((label) => (
          <span key={label.id} className="card-label label-pill" style={{ background: label.color }}>
            {label.name}
            <button className="label-remove" aria-label={`${label.name} 라벨 제거`} onClick={() => toggle(label.id)}>
              <X size={12} />
            </button>
          </span>
        ))}
        <button className="btn btn-subtle btn-sm" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} />
          라벨
        </button>
      </div>

      {open && (
        <div className="menu-popover label-popover">
          {allLabels.length > 0 && (
            <div className="label-popover-list">
              {allLabels.map((label) =>
                editingId === label.id ? (
                  <div key={label.id} className="label-edit">
                    <input
                      autoFocus
                      maxLength={40}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitEdit()
                      }}
                    />
                    <div className="color-swatches">
                      {LABEL_COLORS.map((color) => (
                        <button
                          key={color}
                          className={`color-swatch${editColor === color ? ' selected' : ''}`}
                          style={{ background: color }}
                          aria-label={`색상 ${color}`}
                          onClick={() => setEditColor(color)}
                        />
                      ))}
                    </div>
                    <div className="label-edit-actions">
                      <button className="btn btn-primary btn-sm" onClick={commitEdit} disabled={!editName.trim()}>
                        저장
                      </button>
                      <button className="btn btn-subtle btn-sm" onClick={() => setEditingId(null)}>
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={label.id} className="label-popover-row">
                    <label className="menu-item label-menu-item">
                      <input
                        type="checkbox"
                        checked={card.labelIds.includes(label.id)}
                        onChange={() => toggle(label.id)}
                      />
                      <span className="label-swatch" style={{ background: label.color }} />
                      {label.name}
                    </label>
                    <button
                      className="btn btn-icon btn-sm"
                      aria-label={`${label.name} 라벨 편집`}
                      title="이름·색 편집"
                      onClick={() => startEdit(label.id)}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="btn btn-icon btn-sm"
                      aria-label={`${label.name} 라벨 삭제`}
                      title="보드에서 라벨 삭제"
                      onClick={() => deleteLabel(label.id, label.name)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ),
              )}
            </div>
          )}
          <div className="label-create">
            <input
              placeholder="새 라벨 이름"
              maxLength={40}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) createLabel()
              }}
            />
            <div className="color-swatches">
              {LABEL_COLORS.map((color) => (
                <button
                  key={color}
                  className={`color-swatch${newColor === color ? ' selected' : ''}`}
                  style={{ background: color }}
                  aria-label={`색상 ${color}`}
                  onClick={() => setNewColor(color)}
                />
              ))}
            </div>
            <button className="btn btn-primary btn-sm" onClick={createLabel} disabled={!newName.trim()}>
              만들기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
