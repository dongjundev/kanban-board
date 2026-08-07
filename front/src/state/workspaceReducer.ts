import type { BoardState, Card, Column, Label, Workspace } from '../types'
import { boardReducer } from './boardReducer'
import type { BoardAction } from './boardReducer'
import { clamp } from '../utils'

export type WorkspaceAction =
  | BoardAction
  | { type: 'CREATE_BOARD'; boardId: string; board: BoardState }
  | { type: 'DELETE_BOARD'; boardId: string }
  | { type: 'SELECT_BOARD'; boardId: string }
  | { type: 'MOVE_BOARD'; boardId: string; toIndex: number }
  | { type: 'REPLACE_WORKSPACE'; workspace: Workspace }
  | { type: 'RESTORE_BOARD_LAYOUT'; boardId: string; columns: Record<string, Column>; columnOrder: string[] }
  // 삭제 실행 취소용 대상 지정 복원 — 전체 스냅샷 교체와 달리
  // 삭제~취소 사이에 일어난 무관한 변경을 덮어쓰지 않는다. 이미 복원돼 있으면 no-op.
  | { type: 'RESTORE_CARD'; boardId: string; columnId: string; index: number; card: Card }
  | { type: 'RESTORE_COLUMN'; boardId: string; column: Column; cards: Card[]; index: number }
  | { type: 'RESTORE_LABEL'; boardId: string; label: Label; cardIds: string[] }
  | { type: 'RESTORE_BOARD'; boardId: string; board: BoardState; index: number }

export function workspaceReducer(ws: Workspace, action: WorkspaceAction): Workspace {
  switch (action.type) {
    case 'CREATE_BOARD': {
      if (!action.board.boardTitle.trim() || ws.boards[action.boardId]) return ws
      return {
        boards: { ...ws.boards, [action.boardId]: action.board },
        boardOrder: [...ws.boardOrder, action.boardId],
        activeBoardId: action.boardId, // 새 보드는 바로 활성화
      }
    }

    case 'DELETE_BOARD': {
      // 마지막 남은 보드는 삭제 불가
      if (!ws.boards[action.boardId] || ws.boardOrder.length <= 1) return ws
      const boards = { ...ws.boards }
      delete boards[action.boardId]
      const boardOrder = ws.boardOrder.filter((id) => id !== action.boardId)
      let activeBoardId = ws.activeBoardId
      if (activeBoardId === action.boardId) {
        // 활성 보드를 지우면 이전 순서의 보드로 이동
        const oldIndex = ws.boardOrder.indexOf(action.boardId)
        activeBoardId = boardOrder[Math.max(0, oldIndex - 1)]
      }
      return { boards, boardOrder, activeBoardId }
    }

    case 'SELECT_BOARD': {
      if (!ws.boards[action.boardId] || ws.activeBoardId === action.boardId) return ws
      return { ...ws, activeBoardId: action.boardId }
    }

    case 'MOVE_BOARD': {
      const fromIndex = ws.boardOrder.indexOf(action.boardId)
      if (fromIndex === -1) return ws
      const toIndex = clamp(action.toIndex, 0, ws.boardOrder.length - 1)
      if (fromIndex === toIndex) return ws
      const boardOrder = [...ws.boardOrder]
      boardOrder.splice(fromIndex, 1)
      boardOrder.splice(toIndex, 0, action.boardId)
      return { ...ws, boardOrder }
    }

    case 'RESTORE_BOARD_LAYOUT': {
      // 드래그 취소 롤백 — 스냅샷을 뜬 '그 보드'에만, 아직 존재할 때만 복원.
      // 활성 보드가 그 사이 바뀌었어도 다른 보드를 오염시키지 않는다.
      const board = ws.boards[action.boardId]
      if (!board) return ws

      // 스냅샷을 기반으로 하되, 스냅샷 이후(예: 다른 탭에서) 생긴 컬럼은 보존.
      // 단, 그 사이 삭제된 컬럼을 되살리면 안 되므로 현재 보드에 남아 있는 것만 취한다.
      const columns: Record<string, Column> = {}
      const columnOrder: string[] = []
      for (const id of action.columnOrder) {
        if (board.columns[id] && action.columns[id]) {
          columns[id] = action.columns[id]
          columnOrder.push(id)
        }
      }
      // 스냅샷 이후 생긴 컬럼을 덧붙인다. 이때 스냅샷이 이미 갖고 있는 카드는 빼야 한다 —
      // 드래그 중 그 컬럼으로 옮겨진 카드를 그대로 두면 두 컬럼에 동시에 존재하게 된다.
      const fromSnapshot = new Set(Object.values(columns).flatMap((c) => c.cardIds))
      for (const [id, column] of Object.entries(board.columns)) {
        if (columns[id]) continue
        columns[id] = { ...column, cardIds: column.cardIds.filter((cardId) => !fromSnapshot.has(cardId)) }
        columnOrder.push(id)
      }
      // 스냅샷 이후 삭제된 카드를 가리키는 참조 제거 (검증 무결성 유지)
      for (const [id, column] of Object.entries(columns)) {
        if (!column.cardIds.every((cardId) => board.cards[cardId] !== undefined)) {
          columns[id] = { ...column, cardIds: column.cardIds.filter((cardId) => board.cards[cardId] !== undefined) }
        }
      }
      // 스냅샷 이후 추가된 카드가 고아가 되지 않도록 현재 위치(또는 첫 컬럼)에 다시 붙임
      const referenced = new Set(Object.values(columns).flatMap((c) => c.cardIds))
      for (const cardId of Object.keys(board.cards)) {
        if (referenced.has(cardId)) continue
        const currentColumn = Object.values(board.columns).find((c) => c.cardIds.includes(cardId))
        const targetId = currentColumn && columns[currentColumn.id] ? currentColumn.id : columnOrder[0]
        if (targetId && columns[targetId]) {
          columns[targetId] = { ...columns[targetId], cardIds: [...columns[targetId].cardIds, cardId] }
        }
      }

      return {
        ...ws,
        boards: {
          ...ws.boards,
          [action.boardId]: { ...board, columns, columnOrder },
        },
      }
    }

    case 'RESTORE_CARD': {
      const board = ws.boards[action.boardId]
      if (!board || board.cards[action.card.id]) return ws
      const column = board.columns[action.columnId]
      if (!column) return ws
      const cardIds = [...column.cardIds]
      cardIds.splice(clamp(action.index, 0, cardIds.length), 0, action.card.id)
      return {
        ...ws,
        boards: {
          ...ws.boards,
          [action.boardId]: {
            ...board,
            cards: { ...board.cards, [action.card.id]: action.card },
            columns: { ...board.columns, [column.id]: { ...column, cardIds } },
          },
        },
      }
    }

    case 'RESTORE_COLUMN': {
      const board = ws.boards[action.boardId]
      if (!board || board.columns[action.column.id]) return ws
      const cards = { ...board.cards }
      for (const card of action.cards) {
        if (!cards[card.id]) cards[card.id] = card
      }
      const column = { ...action.column, cardIds: action.column.cardIds.filter((id) => cards[id] !== undefined) }
      const columnOrder = [...board.columnOrder]
      columnOrder.splice(clamp(action.index, 0, columnOrder.length), 0, column.id)
      return {
        ...ws,
        boards: {
          ...ws.boards,
          [action.boardId]: { ...board, cards, columns: { ...board.columns, [column.id]: column }, columnOrder },
        },
      }
    }

    case 'RESTORE_LABEL': {
      const board = ws.boards[action.boardId]
      if (!board || board.labels[action.label.id]) return ws
      const cards = { ...board.cards }
      for (const cardId of action.cardIds) {
        const card = cards[cardId]
        if (card && !card.labelIds.includes(action.label.id)) {
          cards[cardId] = { ...card, labelIds: [...card.labelIds, action.label.id] }
        }
      }
      return {
        ...ws,
        boards: {
          ...ws.boards,
          [action.boardId]: { ...board, cards, labels: { ...board.labels, [action.label.id]: action.label } },
        },
      }
    }

    case 'RESTORE_BOARD': {
      if (ws.boards[action.boardId]) return ws
      const boardOrder = [...ws.boardOrder]
      boardOrder.splice(clamp(action.index, 0, boardOrder.length), 0, action.boardId)
      return {
        ...ws,
        boards: { ...ws.boards, [action.boardId]: action.board },
        boardOrder,
      }
    }

    case 'REPLACE_WORKSPACE': {
      // 다른 탭 동기화: 그쪽 탭의 보드 전환이 이 탭의 활성 보드를 바꾸지 않도록 유지
      // (이 탭의 활성 보드가 삭제된 경우에만 넘어온 값을 따름)
      const next = action.workspace
      const activeBoardId = next.boards[ws.activeBoardId] ? ws.activeBoardId : next.activeBoardId
      return { ...next, activeBoardId }
    }

    // 보드 레벨 액션은 활성 보드에 위임
    default: {
      const board = ws.boards[ws.activeBoardId]
      if (!board) return ws
      const next = boardReducer(board, action)
      if (next === board) return ws
      return { ...ws, boards: { ...ws.boards, [ws.activeBoardId]: next } }
    }
  }
}
