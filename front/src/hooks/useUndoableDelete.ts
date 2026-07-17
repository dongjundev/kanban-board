import { useRef } from 'react'
import type { Workspace } from '../types'
import { useBoard } from '../state/BoardContext'
import { findColumnOfCard } from '../state/boardReducer'
import type { WorkspaceAction } from '../state/workspaceReducer'
import { useToast } from '../components/Toast'

type DeleteAction =
  | { type: 'DELETE_CARD'; cardId: string }
  | { type: 'DELETE_COLUMN'; columnId: string }
  | { type: 'DELETE_LABEL'; labelId: string }
  | { type: 'DELETE_BOARD'; boardId: string }

/** 삭제 직전 상태에서 "무엇을 어디에 되살릴지"만 캡처한 대상 지정 복원 액션을 만든다 */
function buildUndo(ws: Workspace, action: DeleteAction): WorkspaceAction | null {
  const boardId = ws.activeBoardId
  const board = ws.boards[boardId]
  switch (action.type) {
    case 'DELETE_CARD': {
      const card = board?.cards[action.cardId]
      const column = board ? findColumnOfCard(board, action.cardId) : undefined
      if (!board || !card || !column) return null
      return { type: 'RESTORE_CARD', boardId, columnId: column.id, index: column.cardIds.indexOf(card.id), card }
    }
    case 'DELETE_COLUMN': {
      const column = board?.columns[action.columnId]
      if (!board || !column) return null
      return {
        type: 'RESTORE_COLUMN',
        boardId,
        column,
        cards: column.cardIds.map((id) => board.cards[id]).filter((c) => c !== undefined),
        index: board.columnOrder.indexOf(column.id),
      }
    }
    case 'DELETE_LABEL': {
      const label = board?.labels[action.labelId]
      if (!board || !label) return null
      return {
        type: 'RESTORE_LABEL',
        boardId,
        label,
        cardIds: Object.values(board.cards)
          .filter((c) => c.labelIds.includes(label.id))
          .map((c) => c.id),
      }
    }
    case 'DELETE_BOARD': {
      const target = ws.boards[action.boardId]
      if (!target) return null
      return {
        type: 'RESTORE_BOARD',
        boardId: action.boardId,
        board: target,
        index: ws.boardOrder.indexOf(action.boardId),
      }
    }
  }
}

/**
 * 삭제를 실행하고 '실행 취소' 토스트를 띄운다.
 * 복원은 삭제된 대상만 되돌리는 targeted restore — 토스트가 떠 있는 동안(또는
 * confirm 대기 중) 수행한 다른 변경을 덮어쓰지 않는다.
 */
export function useUndoableDelete() {
  const { workspace, dispatch } = useBoard()
  const { showToast } = useToast()
  // 삭제 핸들러가 confirm을 await하는 동안에도 dispatch '시점'의 상태를 캡처하도록
  // 렌더 클로저 대신 항상 최신 워크스페이스를 가리키는 ref를 쓴다
  const latest = useRef(workspace)
  latest.current = workspace

  return (action: DeleteAction, message: string) => {
    const undo = buildUndo(latest.current, action)
    dispatch(action)
    showToast(
      message,
      undo
        ? () => {
            dispatch(undo)
            if (undo.type === 'RESTORE_BOARD') dispatch({ type: 'SELECT_BOARD', boardId: undo.boardId })
          }
        : undefined,
    )
  }
}
