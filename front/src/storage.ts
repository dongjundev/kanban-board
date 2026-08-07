import type { BoardState, Workspace } from './types'
import { uid } from './utils'

/** v1: 단일 보드 시절의 레거시 키 — 마이그레이션 소스로만 읽음 */
const LEGACY_BOARD_KEY = 'kanban-board-state-v1'
export const WORKSPACE_KEY = 'kanban-workspace-v1'

/**
 * `id in obj`는 프로토타입 체인까지 본다 — 'constructor'·'toString' 같은 id가
 * 존재하는 키로 통과해, 검증을 통과한 데이터가 렌더에서 undefined를 터뜨린다
 * (흰 화면). 검증은 반드시 own 속성만 인정해야 한다.
 */
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function isValidCard(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    isStringArray(value.labelIds) &&
    typeof value.assignee === 'string' &&
    (value.dueDate === null || typeof value.dueDate === 'string') &&
    typeof value.createdAt === 'string'
  )
}

function isValidColumn(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.title === 'string' && isStringArray(value.cardIds)
}

function isValidLabel(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.name === 'string' && typeof value.color === 'string'
}

/** 보드 구조 + 참조 무결성 검증 — 깨진 데이터로 렌더 크래시 루프에 빠지지 않도록 방어 */
function isValidState(value: unknown): value is BoardState {
  if (!isRecord(value)) return false
  const { boardTitle, columns, columnOrder, cards, labels } = value
  if (typeof boardTitle !== 'string') return false
  if (!isRecord(columns) || !isRecord(cards) || !isRecord(labels) || !isStringArray(columnOrder)) return false
  if (!Object.values(columns).every(isValidColumn)) return false
  if (!Object.values(cards).every(isValidCard)) return false
  if (!Object.values(labels).every(isValidLabel)) return false
  if (!columnOrder.every((id) => hasOwn(columns, id))) return false
  // 모든 컬럼의 cardIds가 실제 존재하는 카드를 가리키는지
  const columnList = Object.values(columns) as Array<{ cardIds: string[] }>
  return columnList.every((col) => col.cardIds.every((cardId) => hasOwn(cards, cardId)))
}

export function isValidWorkspace(value: unknown): value is Workspace {
  if (!isRecord(value)) return false
  const { boards, boardOrder, activeBoardId } = value
  if (!isRecord(boards) || !isStringArray(boardOrder) || typeof activeBoardId !== 'string') return false
  if (boardOrder.length === 0) return false
  if (!Object.values(boards).every(isValidState)) return false
  // boardOrder와 boards 키가 정확히 일치하고 활성 보드가 존재해야 함
  const keys = Object.keys(boards)
  if (keys.length !== boardOrder.length || !boardOrder.every((id) => hasOwn(boards, id))) return false
  return hasOwn(boards, activeBoardId)
}

/** JSON 문자열 → 검증된 BoardState (실패 시 null) */
function parseState(raw: string): BoardState | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isValidState(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** JSON 문자열 → 검증된 Workspace (실패 시 null) */
export function parseWorkspace(raw: string): Workspace | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isValidWorkspace(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** v1 단일 보드를 워크스페이스로 승격 */
export function wrapLegacyBoard(board: BoardState): Workspace {
  const boardId = `board-${uid()}`
  return { boards: { [boardId]: board }, boardOrder: [boardId], activeBoardId: boardId }
}

export function loadWorkspace(): Workspace | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY)
    if (raw) return parseWorkspace(raw)
    // 워크스페이스가 없으면 레거시 단일 보드에서 마이그레이션 (레거시 키는 롤백 대비 보존)
    const legacy = localStorage.getItem(LEGACY_BOARD_KEY)
    if (legacy) {
      const board = parseState(legacy)
      if (board) return wrapLegacyBoard(board)
    }
    return null
  } catch {
    return null
  }
}

export function saveWorkspace(workspace: Workspace): void {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace))
  } catch {
    // 저장 공간 부족 등 — 앱 동작은 계속하되 저장만 건너뜀
  }
}

/**
 * 로컬 미러가 기반으로 삼은 서버 버전.
 * 재접속 시 "미러 내용 ≠ 서버 문서 && 기반 버전 == 서버 버전"이면
 * 미러에 미전송 변경이 있다는 뜻이므로 서버로 밀어올린다 (유실 방지 재조정).
 */
const BASE_VERSION_KEY = 'kanban-workspace-base-version'

export function loadBaseVersion(): number {
  try {
    const value = Number(localStorage.getItem(BASE_VERSION_KEY))
    return Number.isFinite(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

export function saveBaseVersion(version: number): void {
  try {
    localStorage.setItem(BASE_VERSION_KEY, String(version))
  } catch {
    // 무시
  }
}
