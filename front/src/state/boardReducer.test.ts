import { describe, expect, it } from 'vitest'
import type { BoardState, Card } from '../types'
import { boardReducer, findColumnOfCard } from './boardReducer'

function makeCard(id: string, title = `카드 ${id}`): Card {
  return { id, title, description: '', labelIds: [], assignee: '', dueDate: null, createdAt: '2026-01-01T00:00:00.000Z' }
}

function makeState(): BoardState {
  return {
    boardTitle: '보드',
    columns: {
      a: { id: 'a', title: 'A', cardIds: ['c1', 'c2', 'c3'] },
      b: { id: 'b', title: 'B', cardIds: ['c4'] },
      empty: { id: 'empty', title: 'Empty', cardIds: [] },
    },
    columnOrder: ['a', 'b', 'empty'],
    cards: { c1: makeCard('c1'), c2: makeCard('c2'), c3: makeCard('c3'), c4: makeCard('c4') },
    labels: { l1: { id: 'l1', name: '버그', color: '#F87168' } },
  }
}

describe('컬럼 액션', () => {
  it('ADD_COLUMN은 끝에 컬럼을 추가한다', () => {
    const next = boardReducer(makeState(), { type: 'ADD_COLUMN', column: { id: 'new', title: '새 컬럼', cardIds: [] } })
    expect(next.columnOrder).toEqual(['a', 'b', 'empty', 'new'])
    expect(next.columns.new.title).toBe('새 컬럼')
  })

  it('빈 제목의 ADD_COLUMN은 무시된다', () => {
    const state = makeState()
    expect(boardReducer(state, { type: 'ADD_COLUMN', column: { id: 'x', title: '  ', cardIds: [] } })).toBe(state)
  })

  it('RENAME_COLUMN은 제목을 trim해서 반영한다', () => {
    const next = boardReducer(makeState(), { type: 'RENAME_COLUMN', columnId: 'a', title: '  진행 중  ' })
    expect(next.columns.a.title).toBe('진행 중')
  })

  it('DELETE_COLUMN은 컬럼과 소속 카드를 함께 삭제한다', () => {
    const next = boardReducer(makeState(), { type: 'DELETE_COLUMN', columnId: 'a' })
    expect(next.columnOrder).toEqual(['b', 'empty'])
    expect(next.columns.a).toBeUndefined()
    expect(next.cards.c1).toBeUndefined()
    expect(next.cards.c4).toBeDefined()
  })

  it('MOVE_COLUMN은 순서를 바꾸고 인덱스를 clamp한다', () => {
    const next = boardReducer(makeState(), { type: 'MOVE_COLUMN', columnId: 'a', toIndex: 99 })
    expect(next.columnOrder).toEqual(['b', 'empty', 'a'])
  })

  it('같은 위치로의 MOVE_COLUMN은 no-op', () => {
    const state = makeState()
    expect(boardReducer(state, { type: 'MOVE_COLUMN', columnId: 'a', toIndex: 0 })).toBe(state)
  })
})

describe('카드 액션', () => {
  it('ADD_CARD는 컬럼 끝에 카드를 추가한다', () => {
    const next = boardReducer(makeState(), { type: 'ADD_CARD', columnId: 'b', card: makeCard('c9') })
    expect(next.columns.b.cardIds).toEqual(['c4', 'c9'])
    expect(next.cards.c9).toBeDefined()
  })

  it("ADD_CARD at:'start'는 컬럼 맨 앞에 추가한다", () => {
    const next = boardReducer(makeState(), { type: 'ADD_CARD', columnId: 'a', card: makeCard('c9'), at: 'start' })
    expect(next.columns.a.cardIds).toEqual(['c9', 'c1', 'c2', 'c3'])
  })

  it('UPDATE_CARD는 patch를 병합하되 빈 제목은 무시한다', () => {
    const next = boardReducer(makeState(), { type: 'UPDATE_CARD', cardId: 'c1', patch: { title: ' ', assignee: '김동준' } })
    expect(next.cards.c1.title).toBe('카드 c1')
    expect(next.cards.c1.assignee).toBe('김동준')
  })

  it('DELETE_CARD는 카드와 컬럼 참조를 지운다', () => {
    const next = boardReducer(makeState(), { type: 'DELETE_CARD', cardId: 'c2' })
    expect(next.cards.c2).toBeUndefined()
    expect(next.columns.a.cardIds).toEqual(['c1', 'c3'])
  })
})

describe('MOVE_CARD', () => {
  it('같은 컬럼 안에서 순서를 바꾼다 (arrayMove 의미론)', () => {
    // c1을 인덱스 2로: [c1,c2,c3] → [c2,c3,c1]
    const next = boardReducer(makeState(), { type: 'MOVE_CARD', cardId: 'c1', toColumnId: 'a', toIndex: 2 })
    expect(next.columns.a.cardIds).toEqual(['c2', 'c3', 'c1'])
  })

  it('다른 컬럼의 중간 위치로 이동한다', () => {
    const next = boardReducer(makeState(), { type: 'MOVE_CARD', cardId: 'c1', toColumnId: 'b', toIndex: 0 })
    expect(next.columns.a.cardIds).toEqual(['c2', 'c3'])
    expect(next.columns.b.cardIds).toEqual(['c1', 'c4'])
  })

  it('빈 컬럼으로 이동한다', () => {
    const next = boardReducer(makeState(), { type: 'MOVE_CARD', cardId: 'c4', toColumnId: 'empty', toIndex: 0 })
    expect(next.columns.b.cardIds).toEqual([])
    expect(next.columns.empty.cardIds).toEqual(['c4'])
  })

  it('인덱스가 범위를 벗어나면 clamp된다', () => {
    const next = boardReducer(makeState(), { type: 'MOVE_CARD', cardId: 'c1', toColumnId: 'b', toIndex: 99 })
    expect(next.columns.b.cardIds).toEqual(['c4', 'c1'])
  })

  it('제자리 이동은 no-op (참조 동일)', () => {
    const state = makeState()
    expect(boardReducer(state, { type: 'MOVE_CARD', cardId: 'c1', toColumnId: 'a', toIndex: 0 })).toBe(state)
  })

  it('존재하지 않는 카드/컬럼이면 no-op', () => {
    const state = makeState()
    expect(boardReducer(state, { type: 'MOVE_CARD', cardId: 'nope', toColumnId: 'a', toIndex: 0 })).toBe(state)
    expect(boardReducer(state, { type: 'MOVE_CARD', cardId: 'c1', toColumnId: 'nope', toIndex: 0 })).toBe(state)
  })
})

describe('라벨 액션', () => {
  it('UPDATE_LABEL은 이름과 색을 수정하되 빈 이름은 무시한다', () => {
    let next = boardReducer(makeState(), { type: 'UPDATE_LABEL', labelId: 'l1', patch: { name: ' 긴급 ', color: '#579DFF' } })
    expect(next.labels.l1).toEqual({ id: 'l1', name: '긴급', color: '#579DFF' })
    next = boardReducer(next, { type: 'UPDATE_LABEL', labelId: 'l1', patch: { name: '  ' } })
    expect(next.labels.l1.name).toBe('긴급')
  })

  it('없는 라벨의 UPDATE_LABEL은 no-op', () => {
    const state = makeState()
    expect(boardReducer(state, { type: 'UPDATE_LABEL', labelId: 'nope', patch: { name: 'x' } })).toBe(state)
  })

  it('DELETE_LABEL은 모든 카드에서 라벨 참조를 제거한다', () => {
    let state = makeState()
    state = boardReducer(state, { type: 'UPDATE_CARD', cardId: 'c1', patch: { labelIds: ['l1'] } })
    const next = boardReducer(state, { type: 'DELETE_LABEL', labelId: 'l1' })
    expect(next.labels.l1).toBeUndefined()
    expect(next.cards.c1.labelIds).toEqual([])
  })
})

describe('불변성', () => {
  it('리듀서는 원본 상태를 변경하지 않는다', () => {
    const state = makeState()
    const snapshot = JSON.parse(JSON.stringify(state)) as unknown
    boardReducer(state, { type: 'MOVE_CARD', cardId: 'c1', toColumnId: 'b', toIndex: 1 })
    boardReducer(state, { type: 'DELETE_COLUMN', columnId: 'a' })
    expect(state).toEqual(snapshot)
  })
})

describe('findColumnOfCard', () => {
  it('카드가 속한 컬럼을 찾는다', () => {
    expect(findColumnOfCard(makeState(), 'c4')?.id).toBe('b')
    expect(findColumnOfCard(makeState(), 'nope')).toBeUndefined()
  })
})
