import { describe, expect, it } from 'vitest'
import type { BoardState, Workspace } from '../types'
import { workspaceReducer } from './workspaceReducer'
import { wrapLegacyBoard, parseWorkspace } from '../storage'

function makeBoard(title: string): BoardState {
  return {
    boardTitle: title,
    columns: { col: { id: 'col', title: '할 일', cardIds: [] } },
    columnOrder: ['col'],
    cards: {},
    labels: {},
  }
}

function makeWorkspace(): Workspace {
  return {
    boards: { b1: makeBoard('보드 1'), b2: makeBoard('보드 2'), b3: makeBoard('보드 3') },
    boardOrder: ['b1', 'b2', 'b3'],
    activeBoardId: 'b2',
  }
}

describe('CREATE_BOARD', () => {
  it('보드를 추가하고 바로 활성화한다', () => {
    const next = workspaceReducer(makeWorkspace(), { type: 'CREATE_BOARD', boardId: 'b4', board: makeBoard('새 보드') })
    expect(next.boardOrder).toEqual(['b1', 'b2', 'b3', 'b4'])
    expect(next.activeBoardId).toBe('b4')
  })

  it('중복 id나 빈 제목이면 no-op', () => {
    const ws = makeWorkspace()
    expect(workspaceReducer(ws, { type: 'CREATE_BOARD', boardId: 'b1', board: makeBoard('x') })).toBe(ws)
    expect(workspaceReducer(ws, { type: 'CREATE_BOARD', boardId: 'b9', board: makeBoard('  ') })).toBe(ws)
  })
})

describe('DELETE_BOARD', () => {
  it('활성 보드 삭제 시 이전 순서의 보드로 이동한다', () => {
    const next = workspaceReducer(makeWorkspace(), { type: 'DELETE_BOARD', boardId: 'b2' })
    expect(next.boardOrder).toEqual(['b1', 'b3'])
    expect(next.activeBoardId).toBe('b1')
    expect(next.boards.b2).toBeUndefined()
  })

  it('첫 번째 활성 보드를 삭제하면 다음 보드로 이동한다', () => {
    const ws = { ...makeWorkspace(), activeBoardId: 'b1' }
    const next = workspaceReducer(ws, { type: 'DELETE_BOARD', boardId: 'b1' })
    expect(next.activeBoardId).toBe('b2')
  })

  it('비활성 보드 삭제는 활성 보드를 유지한다', () => {
    const next = workspaceReducer(makeWorkspace(), { type: 'DELETE_BOARD', boardId: 'b3' })
    expect(next.activeBoardId).toBe('b2')
  })

  it('마지막 남은 보드는 삭제할 수 없다', () => {
    const ws: Workspace = { boards: { b1: makeBoard('유일') }, boardOrder: ['b1'], activeBoardId: 'b1' }
    expect(workspaceReducer(ws, { type: 'DELETE_BOARD', boardId: 'b1' })).toBe(ws)
  })
})

describe('SELECT_BOARD', () => {
  it('존재하는 보드로 전환한다', () => {
    expect(workspaceReducer(makeWorkspace(), { type: 'SELECT_BOARD', boardId: 'b3' }).activeBoardId).toBe('b3')
  })

  it('없는 보드나 현재 보드는 no-op', () => {
    const ws = makeWorkspace()
    expect(workspaceReducer(ws, { type: 'SELECT_BOARD', boardId: 'nope' })).toBe(ws)
    expect(workspaceReducer(ws, { type: 'SELECT_BOARD', boardId: 'b2' })).toBe(ws)
  })
})

describe('MOVE_BOARD', () => {
  it('보드 순서를 바꾸고 인덱스를 clamp한다', () => {
    const next = workspaceReducer(makeWorkspace(), { type: 'MOVE_BOARD', boardId: 'b1', toIndex: 99 })
    expect(next.boardOrder).toEqual(['b2', 'b3', 'b1'])
    expect(next.activeBoardId).toBe('b2')
  })

  it('같은 위치·없는 보드는 no-op', () => {
    const ws = makeWorkspace()
    expect(workspaceReducer(ws, { type: 'MOVE_BOARD', boardId: 'b1', toIndex: 0 })).toBe(ws)
    expect(workspaceReducer(ws, { type: 'MOVE_BOARD', boardId: 'nope', toIndex: 1 })).toBe(ws)
  })
})

describe('REPLACE_WORKSPACE (탭 간 동기화)', () => {
  it('내 활성 보드가 살아있으면 유지한다 (다른 탭의 전환에 끌려가지 않음)', () => {
    const incoming = { ...makeWorkspace(), activeBoardId: 'b3' }
    const next = workspaceReducer(makeWorkspace(), { type: 'REPLACE_WORKSPACE', workspace: incoming })
    expect(next.activeBoardId).toBe('b2')
    expect(next.boards).toBe(incoming.boards)
  })

  it('내 활성 보드가 삭제됐으면 넘어온 활성 보드를 따른다', () => {
    const incoming: Workspace = {
      boards: { b1: makeBoard('보드 1'), b3: makeBoard('보드 3') },
      boardOrder: ['b1', 'b3'],
      activeBoardId: 'b3',
    }
    const next = workspaceReducer(makeWorkspace(), { type: 'REPLACE_WORKSPACE', workspace: incoming })
    expect(next.activeBoardId).toBe('b3')
  })
})

describe('보드 액션 위임', () => {
  it('활성 보드에만 적용된다', () => {
    const ws = makeWorkspace()
    const next = workspaceReducer(ws, { type: 'RENAME_COLUMN', columnId: 'col', title: '백로그' })
    expect(next.boards.b2.columns.col.title).toBe('백로그')
    expect(next.boards.b1.columns.col.title).toBe('할 일')
    expect(next.boards.b3).toBe(ws.boards.b3) // 다른 보드는 참조 그대로
  })

  it('no-op 보드 액션은 워크스페이스 참조도 유지한다', () => {
    const ws = makeWorkspace()
    expect(workspaceReducer(ws, { type: 'RENAME_COLUMN', columnId: 'nope', title: 'x' })).toBe(ws)
  })

})

describe('RESTORE_BOARD_LAYOUT (드래그 취소 롤백)', () => {
  const snapshot = {
    columns: { col: { id: 'col', title: '할 일', cardIds: ['c1'] } },
    columnOrder: ['col'],
  }

  it('스냅샷을 뜬 보드에 복원한다 — 활성 보드가 바뀌었어도 그 보드를 오염시키지 않음', () => {
    let ws = { ...makeWorkspace(), activeBoardId: 'b1' }
    ws = workspaceReducer(ws, {
      type: 'ADD_CARD',
      columnId: 'col',
      card: { id: 'c1', title: '카드', description: '', labelIds: [], assignee: '', dueDate: null, createdAt: 'x' },
    })
    ws = workspaceReducer(ws, { type: 'SELECT_BOARD', boardId: 'b3' }) // 드래그 중 b1 → b3로 전환된 상황
    const next = workspaceReducer(ws, { type: 'RESTORE_BOARD_LAYOUT', boardId: 'b1', ...snapshot })
    expect(next.boards.b1.columns.col.cardIds).toEqual(['c1'])
    expect(next.boards.b3).toBe(ws.boards.b3) // 현재 활성 보드는 그대로
  })

  it('보드가 삭제됐으면 no-op', () => {
    const ws = makeWorkspace()
    expect(workspaceReducer(ws, { type: 'RESTORE_BOARD_LAYOUT', boardId: 'nope', ...snapshot })).toBe(ws)
  })

  it('레이아웃만 복원하고 카드 내용(cards 맵)은 보존한다', () => {
    let ws = makeWorkspace()
    ws = workspaceReducer(ws, {
      type: 'ADD_CARD',
      columnId: 'col',
      card: { id: 'c1', title: '수정된 제목', description: '', labelIds: [], assignee: '', dueDate: null, createdAt: 'x' },
    })
    const next = workspaceReducer(ws, { type: 'RESTORE_BOARD_LAYOUT', boardId: 'b2', ...snapshot })
    expect(next.boards.b2.cards.c1.title).toBe('수정된 제목')
    expect(next.boards.b2.columnOrder).toEqual(['col'])
  })

  it('스냅샷 이후 추가된 카드는 고아가 되지 않고 현재 컬럼에 다시 붙는다', () => {
    let ws = makeWorkspace()
    // 스냅샷(cardIds: [c1])에는 없는 새 카드가 드래그 도중 추가된 상황
    ws = workspaceReducer(ws, {
      type: 'ADD_CARD',
      columnId: 'col',
      card: { id: 'c1', title: '스냅샷에 있던 카드', description: '', labelIds: [], assignee: '', dueDate: null, createdAt: 'x' },
    })
    ws = workspaceReducer(ws, {
      type: 'ADD_CARD',
      columnId: 'col',
      card: { id: 'c-new', title: '드래그 중 추가', description: '', labelIds: [], assignee: '', dueDate: null, createdAt: 'x' },
    })
    const next = workspaceReducer(ws, { type: 'RESTORE_BOARD_LAYOUT', boardId: 'b2', ...snapshot })
    expect(next.boards.b2.columns.col.cardIds).toContain('c-new')
  })

  it('스냅샷 이후 삭제된 카드 참조는 복원 시 제거된다', () => {
    // 스냅샷 cardIds에 c1이 있지만 현재 cards 맵에는 없음 (드래그 중 원격 삭제)
    const ws = makeWorkspace()
    const next = workspaceReducer(ws, { type: 'RESTORE_BOARD_LAYOUT', boardId: 'b2', ...snapshot })
    expect(next.boards.b2.columns.col.cardIds).toEqual([])
  })
})

describe('대상 지정 복원 (삭제 실행 취소)', () => {
  function cardOf(id: string) {
    return { id, title: `카드 ${id}`, description: '', labelIds: [], assignee: '', dueDate: null, createdAt: 'x' }
  }

  it('RESTORE_CARD는 원래 컬럼·위치에 카드를 되살리고, 이미 있으면 no-op', () => {
    let ws = makeWorkspace()
    ws = workspaceReducer(ws, { type: 'ADD_CARD', columnId: 'col', card: cardOf('c1') })
    ws = workspaceReducer(ws, { type: 'ADD_CARD', columnId: 'col', card: cardOf('c2') })
    const deleted = ws.boards.b2.cards.c1
    ws = workspaceReducer(ws, { type: 'DELETE_CARD', cardId: 'c1' })
    const restore = { type: 'RESTORE_CARD', boardId: 'b2', columnId: 'col', index: 0, card: deleted } as const
    let next = workspaceReducer(ws, restore)
    expect(next.boards.b2.columns.col.cardIds).toEqual(['c1', 'c2'])
    expect(workspaceReducer(next, restore)).toBe(next) // 이중 복원 no-op
  })

  it('RESTORE_CARD는 대상 보드/컬럼이 사라졌으면 no-op', () => {
    const ws = makeWorkspace()
    expect(workspaceReducer(ws, { type: 'RESTORE_CARD', boardId: 'nope', columnId: 'col', index: 0, card: cardOf('x') })).toBe(ws)
    expect(workspaceReducer(ws, { type: 'RESTORE_CARD', boardId: 'b2', columnId: 'nope', index: 0, card: cardOf('x') })).toBe(ws)
  })

  it('RESTORE_CARD는 삭제~취소 사이의 다른 변경을 건드리지 않는다', () => {
    let ws = makeWorkspace()
    ws = workspaceReducer(ws, { type: 'ADD_CARD', columnId: 'col', card: cardOf('c1') })
    const deleted = ws.boards.b2.cards.c1
    ws = workspaceReducer(ws, { type: 'DELETE_CARD', cardId: 'c1' })
    // 토스트가 떠 있는 동안의 다른 작업
    ws = workspaceReducer(ws, { type: 'ADD_CARD', columnId: 'col', card: cardOf('c-during') })
    const next = workspaceReducer(ws, { type: 'RESTORE_CARD', boardId: 'b2', columnId: 'col', index: 0, card: deleted })
    expect(next.boards.b2.columns.col.cardIds).toEqual(['c1', 'c-during'])
    expect(next.boards.b2.cards['c-during']).toBeDefined()
  })

  it('RESTORE_COLUMN은 컬럼과 소속 카드를 원래 위치에 되살린다', () => {
    let ws = makeWorkspace()
    ws = workspaceReducer(ws, { type: 'ADD_CARD', columnId: 'col', card: cardOf('c1') })
    const board = ws.boards.b2
    const column = board.columns.col
    const cards = column.cardIds.map((id) => board.cards[id])
    ws = workspaceReducer(ws, { type: 'DELETE_COLUMN', columnId: 'col' })
    expect(ws.boards.b2.columnOrder).toEqual([])
    const next = workspaceReducer(ws, { type: 'RESTORE_COLUMN', boardId: 'b2', column, cards, index: 0 })
    expect(next.boards.b2.columnOrder).toEqual(['col'])
    expect(next.boards.b2.columns.col.cardIds).toEqual(['c1'])
    expect(next.boards.b2.cards.c1).toBeDefined()
  })

  it('RESTORE_LABEL은 라벨과 카드 지정을 되살린다', () => {
    let ws = makeWorkspace()
    ws = workspaceReducer(ws, { type: 'ADD_LABEL', label: { id: 'l1', name: '버그', color: '#F87168' } })
    ws = workspaceReducer(ws, { type: 'ADD_CARD', columnId: 'col', card: { ...cardOf('c1'), labelIds: ['l1'] } })
    const label = ws.boards.b2.labels.l1
    ws = workspaceReducer(ws, { type: 'DELETE_LABEL', labelId: 'l1' })
    expect(ws.boards.b2.cards.c1.labelIds).toEqual([])
    const next = workspaceReducer(ws, { type: 'RESTORE_LABEL', boardId: 'b2', label, cardIds: ['c1', 'ghost'] })
    expect(next.boards.b2.labels.l1).toEqual(label)
    expect(next.boards.b2.cards.c1.labelIds).toEqual(['l1'])
  })

  it('RESTORE_BOARD는 보드를 원래 순서에 되살린다 (이미 있으면 no-op)', () => {
    const original = makeWorkspace()
    const deletedBoard = original.boards.b2
    let ws = workspaceReducer(original, { type: 'DELETE_BOARD', boardId: 'b2' })
    const next = workspaceReducer(ws, { type: 'RESTORE_BOARD', boardId: 'b2', board: deletedBoard, index: 1 })
    expect(next.boardOrder).toEqual(['b1', 'b2', 'b3'])
    expect(next.boards.b2).toBe(deletedBoard)
    expect(workspaceReducer(next, { type: 'RESTORE_BOARD', boardId: 'b2', board: deletedBoard, index: 1 })).toBe(next)
  })
})

describe('레거시 마이그레이션', () => {
  it('단일 보드를 1-보드 워크스페이스로 감싼다', () => {
    const board = makeBoard('기존 보드')
    const ws = wrapLegacyBoard(board)
    expect(ws.boardOrder).toHaveLength(1)
    expect(ws.boards[ws.activeBoardId]).toBe(board)
  })

  it('감싼 결과는 워크스페이스 검증을 통과한다', () => {
    const ws = wrapLegacyBoard(makeBoard('기존 보드'))
    expect(parseWorkspace(JSON.stringify(ws))).toEqual(ws)
  })
})

describe('parseWorkspace 검증', () => {
  it('boardOrder와 boards 불일치, 없는 activeBoardId를 거부한다', () => {
    const ws = makeWorkspace()
    expect(parseWorkspace(JSON.stringify({ ...ws, activeBoardId: 'nope' }))).toBeNull()
    expect(parseWorkspace(JSON.stringify({ ...ws, boardOrder: ['b1', 'b2'] }))).toBeNull()
    expect(parseWorkspace(JSON.stringify({ ...ws, boards: { ...ws.boards, broken: {} } }))).toBeNull()
    expect(parseWorkspace('{"boards":{},"boardOrder":[],"activeBoardId":"x"}')).toBeNull()
  })
})
