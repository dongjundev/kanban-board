import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Calendar, Trash2, User, X } from 'lucide-react'
import type { Card } from '../types'
import { useBoard } from '../state/BoardContext'
import { findColumnOfCard } from '../state/boardReducer'
import { collectAssignees } from '../utils'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { useConfirm } from './ConfirmDialog'
import { LabelPicker } from './LabelPicker'

interface CardModalProps {
  card: Card
  onClose: () => void
}

export function CardModal({ card, onClose }: CardModalProps) {
  const { state, dispatch } = useBoard()
  const undoableDelete = useUndoableDelete()
  const { confirm } = useConfirm()
  const [titleDraft, setTitleDraft] = useState(card.title)
  const [descDraft, setDescDraft] = useState(card.description)
  const [assigneeDraft, setAssigneeDraft] = useState(card.assignee)
  // Esc로 편집을 '취소'한 경우 blur 커밋을 건너뛰기 위한 플래그
  const cancelEditRef = useRef(false)
  const modalRef = useRef<HTMLDivElement>(null)

  const column = findColumnOfCard(state, card.id)

  const assigneeSuggestions = useMemo(() => collectAssignees(state.cards), [state.cards])

  // 포커스 이동/복원 + Tab 순환 (공용 훅)
  const trapTab = useFocusTrap(modalRef)

  /**
   * 편집 중인 필드의 blur 커밋을 먼저 실행한 뒤 닫는다.
   * Safari는 버튼 클릭이 포커스를 옮기지 않아 자연 blur가 없으므로 명시 호출이 필요.
   * (Esc·확인 버튼·백드롭 클릭 세 경로가 모두 이 함수를 거쳐야 draft 유실이 없다)
   */
  function closeWithCommit() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    onClose()
  }

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape' && !e.isComposing) closeWithCommit()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  function commitTitle() {
    if (cancelEditRef.current) {
      cancelEditRef.current = false
      setTitleDraft(card.title)
      return
    }
    if (titleDraft.trim() && titleDraft.trim() !== card.title) {
      dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch: { title: titleDraft.trim() } })
    } else {
      setTitleDraft(card.title)
    }
  }

  function commitDescription() {
    if (cancelEditRef.current) {
      cancelEditRef.current = false
      setDescDraft(card.description)
      return
    }
    if (descDraft !== card.description) {
      dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch: { description: descDraft } })
    }
  }

  function commitAssignee() {
    if (cancelEditRef.current) {
      cancelEditRef.current = false
      setAssigneeDraft(card.assignee)
      return
    }
    if (assigneeDraft.trim() !== card.assignee) {
      dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch: { assignee: assigneeDraft } })
    }
    setAssigneeDraft(assigneeDraft.trim())
  }

  /** 편집 필드용: Enter=커밋(blur), Esc=취소(원래 값 복원, 모달은 열어둠) */
  function editKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, allowEnterCommit: boolean) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && allowEnterCommit) {
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.stopPropagation() // 모달 닫기(document 핸들러)로 전파 방지
      cancelEditRef.current = true
      e.currentTarget.blur()
    }
  }

  async function deleteCard() {
    if (await confirm({ message: `'${card.title}' 카드를 삭제할까요?` })) {
      onClose()
      undoableDelete({ type: 'DELETE_CARD', cardId: card.id }, `'${card.title}' 카드를 삭제했습니다`)
    }
  }

  const createdAt = new Date(card.createdAt)
  const createdText = `${createdAt.getFullYear()}년 ${createdAt.getMonth() + 1}월 ${createdAt.getDate()}일 생성`

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeWithCommit()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="카드 상세"
        ref={modalRef}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="modal-header">
          <span className="modal-context">{column ? column.title : ''}</span>
          <button className="btn btn-icon" aria-label="닫기" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <input
          className="modal-title"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => editKeyDown(e, true)}
        />

        <div className="modal-fields">
          <div className="modal-field">
            <label className="field-label" htmlFor="card-assignee">
              <User size={14} />
              담당자
            </label>
            <input
              id="card-assignee"
              list="assignee-suggestions"
              placeholder="미지정"
              value={assigneeDraft}
              onChange={(e) => setAssigneeDraft(e.target.value)}
              onBlur={commitAssignee}
              onKeyDown={(e) => editKeyDown(e, true)}
            />
            <datalist id="assignee-suggestions">
              {assigneeSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div className="modal-field">
            <label className="field-label" htmlFor="card-due">
              <Calendar size={14} />
              마감일
            </label>
            <div className="due-field">
              <input
                id="card-due"
                type="date"
                value={card.dueDate ?? ''}
                onChange={(e) =>
                  dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch: { dueDate: e.target.value || null } })
                }
              />
              {card.dueDate && (
                <button
                  className="btn btn-icon btn-sm"
                  aria-label="마감일 지우기"
                  title="마감일 지우기"
                  onClick={() => dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch: { dueDate: null } })}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="modal-field modal-field-wide">
            <span className="field-label">라벨</span>
            <LabelPicker card={card} />
          </div>
        </div>

        <div className="modal-field modal-field-wide">
          <span className="field-label">설명</span>
          <textarea
            className="modal-description"
            rows={5}
            placeholder="설명을 입력하세요"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDescription}
            onKeyDown={(e) => editKeyDown(e, false)}
          />
        </div>

        <div className="modal-footer">
          <span className="modal-created">{createdText}</span>
          <div className="modal-footer-actions">
            <button className="btn btn-danger" onClick={deleteCard}>
              <Trash2 size={14} />
              카드 삭제
            </button>
            <button className="btn btn-primary" onClick={closeWithCommit}>
              확인
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
