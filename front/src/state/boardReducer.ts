import type { BoardState, Card, Column, Label } from '../types'
import { clamp } from '../utils'

export type BoardAction =
  | { type: 'SET_BOARD_TITLE'; title: string }
  | { type: 'ADD_COLUMN'; column: Column }
  | { type: 'RENAME_COLUMN'; columnId: string; title: string }
  | { type: 'DELETE_COLUMN'; columnId: string }
  | { type: 'MOVE_COLUMN'; columnId: string; toIndex: number }
  | { type: 'ADD_CARD'; columnId: string; card: Card; at?: 'start' | 'end' }
  | { type: 'UPDATE_CARD'; cardId: string; patch: Partial<Omit<Card, 'id' | 'createdAt'>> }
  | { type: 'DELETE_CARD'; cardId: string }
  | { type: 'MOVE_CARD'; cardId: string; toColumnId: string; toIndex: number }
  | { type: 'ADD_LABEL'; label: Label }
  | { type: 'UPDATE_LABEL'; labelId: string; patch: Partial<Omit<Label, 'id'>> }
  | { type: 'DELETE_LABEL'; labelId: string }

/** cardId가 속한 컬럼을 찾는다. 없으면 undefined. */
export function findColumnOfCard(state: BoardState, cardId: string): Column | undefined {
  return Object.values(state.columns).find((col) => col.cardIds.includes(cardId))
}

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'SET_BOARD_TITLE': {
      const title = action.title.trim()
      if (!title) return state
      return { ...state, boardTitle: title }
    }

    case 'ADD_COLUMN': {
      const { column } = action
      if (!column.title.trim()) return state
      return {
        ...state,
        columns: { ...state.columns, [column.id]: column },
        columnOrder: [...state.columnOrder, column.id],
      }
    }

    case 'RENAME_COLUMN': {
      const column = state.columns[action.columnId]
      const title = action.title.trim()
      if (!column || !title) return state
      return {
        ...state,
        columns: { ...state.columns, [column.id]: { ...column, title } },
      }
    }

    case 'DELETE_COLUMN': {
      const column = state.columns[action.columnId]
      if (!column) return state
      const columns = { ...state.columns }
      delete columns[column.id]
      const cards = { ...state.cards }
      for (const cardId of column.cardIds) delete cards[cardId]
      return {
        ...state,
        columns,
        cards,
        columnOrder: state.columnOrder.filter((id) => id !== column.id),
      }
    }

    case 'MOVE_COLUMN': {
      const fromIndex = state.columnOrder.indexOf(action.columnId)
      if (fromIndex === -1) return state
      const toIndex = clamp(action.toIndex, 0, state.columnOrder.length - 1)
      if (fromIndex === toIndex) return state
      const columnOrder = [...state.columnOrder]
      columnOrder.splice(fromIndex, 1)
      columnOrder.splice(toIndex, 0, action.columnId)
      return { ...state, columnOrder }
    }

    case 'ADD_CARD': {
      const column = state.columns[action.columnId]
      if (!column || !action.card.title.trim()) return state
      const cardIds =
        action.at === 'start' ? [action.card.id, ...column.cardIds] : [...column.cardIds, action.card.id]
      return {
        ...state,
        cards: { ...state.cards, [action.card.id]: action.card },
        columns: {
          ...state.columns,
          [column.id]: { ...column, cardIds },
        },
      }
    }

    case 'UPDATE_CARD': {
      const card = state.cards[action.cardId]
      if (!card) return state
      const patch = { ...action.patch }
      // 제목을 빈 문자열로 만드는 수정은 무시 (제목은 필수)
      if (patch.title !== undefined && !patch.title.trim()) delete patch.title
      // 담당자 공백 차이로 유령 담당자가 생기지 않도록 항상 trim
      if (patch.assignee !== undefined) patch.assignee = patch.assignee.trim()
      return {
        ...state,
        cards: { ...state.cards, [card.id]: { ...card, ...patch } },
      }
    }

    case 'DELETE_CARD': {
      const column = findColumnOfCard(state, action.cardId)
      if (!state.cards[action.cardId]) return state
      const cards = { ...state.cards }
      delete cards[action.cardId]
      const columns = column
        ? {
            ...state.columns,
            [column.id]: { ...column, cardIds: column.cardIds.filter((id) => id !== action.cardId) },
          }
        : state.columns
      return { ...state, cards, columns }
    }

    case 'MOVE_CARD': {
      const source = findColumnOfCard(state, action.cardId)
      const target = state.columns[action.toColumnId]
      if (!source || !target) return state

      const sourceCardIds = source.cardIds.filter((id) => id !== action.cardId)
      const targetBase = source.id === target.id ? sourceCardIds : [...target.cardIds]
      const toIndex = clamp(action.toIndex, 0, targetBase.length)

      // 같은 컬럼 내 이동에서 위치가 변하지 않으면 no-op
      if (source.id === target.id && target.cardIds[toIndex] === action.cardId) return state

      const targetCardIds = [...targetBase]
      targetCardIds.splice(toIndex, 0, action.cardId)

      const columns = { ...state.columns }
      if (source.id === target.id) {
        columns[target.id] = { ...target, cardIds: targetCardIds }
      } else {
        columns[source.id] = { ...source, cardIds: sourceCardIds }
        columns[target.id] = { ...target, cardIds: targetCardIds }
      }
      return { ...state, columns }
    }

    case 'ADD_LABEL': {
      if (!action.label.name.trim()) return state
      return { ...state, labels: { ...state.labels, [action.label.id]: action.label } }
    }

    case 'UPDATE_LABEL': {
      const label = state.labels[action.labelId]
      if (!label) return state
      const patch = { ...action.patch }
      // 이름을 빈 문자열로 만드는 수정은 무시
      if (patch.name !== undefined) {
        patch.name = patch.name.trim()
        if (!patch.name) delete patch.name
      }
      return { ...state, labels: { ...state.labels, [label.id]: { ...label, ...patch } } }
    }

    case 'DELETE_LABEL': {
      if (!state.labels[action.labelId]) return state
      const labels = { ...state.labels }
      delete labels[action.labelId]
      const cards: BoardState['cards'] = {}
      for (const [id, card] of Object.entries(state.cards)) {
        cards[id] = card.labelIds.includes(action.labelId)
          ? { ...card, labelIds: card.labelIds.filter((l) => l !== action.labelId) }
          : card
      }
      return { ...state, labels, cards }
    }
  }
}
