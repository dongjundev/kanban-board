import { useCallback, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { Announcements, CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { SearchX } from 'lucide-react'
import type { Card, Column as ColumnType, Filters } from '../types'
import { useBoard } from '../state/BoardContext'
import { findColumnOfCard } from '../state/boardReducer'
import { cardMatchesFilters, isFilterActive } from '../filtering'
import { labelsOf } from '../utils'
import { Column } from './Column'
import { CardOverlay } from './CardItem'
import { AddColumnButton } from './AddColumnButton'

interface BoardProps {
  filters: Filters
  /** 필터 활성 중 추가되어 필터와 무관하게 보여줄 카드들 */
  filterExemptIds: string[]
  onCardClick: (cardId: string) => void
  onCardAdded: (cardId: string) => void
  onClearFilters: () => void
}

interface DragSnapshot {
  boardId: string
  columns: Record<string, ColumnType>
  columnOrder: string[]
}

export function Board({ filters, filterExemptIds, onCardClick, onCardAdded, onClearFilters }: BoardProps) {
  const { state, workspace, dispatch } = useBoard()
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  // 드래그 취소(Esc/리사이즈/탭 전환) 시 onDragOver로 이미 옮겨진 카드를 되돌리기 위한 스냅샷.
  // 드래그는 컬럼 배치만 바꾸므로 레이아웃만, 그리고 스냅샷을 뜬 보드 id에 바인딩해 저장한다.
  const dragSnapshot = useRef<DragSnapshot | null>(null)

  // 마우스는 4px 이동으로 즉시 드래그, 터치는 250ms 길게 눌러야 드래그 —
  // 짧은 스와이프가 브라우저 스크롤로 통과되도록 분리 (touch-action: manipulation과 세트)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // 포인터가 보드 영역 밖이면 드롭 대상 없음(over=null) → 드롭 시 원위치 복원.
  // closestCorners가 보드 밖 드롭을 "가장 가까운 컬럼"으로 해석해 엉뚱하게 이동시키는 것을 방지.
  // 키보드 드래그는 pointerCoordinates가 없으므로 그대로 closestCorners를 쓴다.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointer = args.pointerCoordinates
    const rect = boardRef.current?.getBoundingClientRect()
    if (pointer && rect) {
      const outside = pointer.x < rect.left || pointer.x > rect.right || pointer.y < rect.top || pointer.y > rect.bottom
      if (outside) return []
    }
    return closestCorners(args)
  }, [])

  /** over 대상(카드 또는 컬럼)을 컬럼으로 해석 */
  function resolveColumn(overId: string, overType: unknown): ColumnType | undefined {
    return overType === 'column' ? state.columns[overId] : findColumnOfCard(state, overId)
  }

  /** 드래그 대상 id → 사용자에게 읽어줄 이름 (스크린리더 알림용) */
  function nameOf(id: string): string {
    return state.cards[id]?.title ?? state.columns[id]?.title ?? '항목'
  }

  function containerNameOf(id: string): string {
    if (state.columns[id]) return `'${state.columns[id].title}' 컬럼`
    const column = findColumnOfCard(state, id)
    return column ? `'${column.title}' 컬럼` : '보드'
  }

  const announcements: Announcements = {
    onDragStart({ active }) {
      return `'${nameOf(String(active.id))}'을(를) 들었습니다.`
    },
    onDragOver({ active, over }) {
      if (!over) return undefined
      return `'${nameOf(String(active.id))}'을(를) ${containerNameOf(String(over.id))} 위로 이동했습니다.`
    },
    onDragEnd({ active, over }) {
      if (!over) return `'${nameOf(String(active.id))}' 이동을 취소했습니다.`
      return `'${nameOf(String(active.id))}'을(를) ${containerNameOf(String(over.id))}에 놓았습니다.`
    },
    onDragCancel({ active }) {
      return `'${nameOf(String(active.id))}' 이동을 취소했습니다.`
    },
  }

  function handleDragStart(event: DragStartEvent) {
    dragSnapshot.current = {
      boardId: workspace.activeBoardId,
      columns: state.columns,
      columnOrder: state.columnOrder,
    }
    const type = event.active.data.current?.type
    if (type === 'column') setActiveColumnId(String(event.active.id))
    else setActiveCardId(String(event.active.id))
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    // 컬럼 드래그는 dragEnd에서만 처리, 카드의 컬럼 간 이동만 실시간 반영
    if (!over || active.data.current?.type !== 'card') return

    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    const sourceColumn = findColumnOfCard(state, activeId)
    const targetColumn = resolveColumn(overId, over.data.current?.type)
    if (!sourceColumn || !targetColumn || sourceColumn.id === targetColumn.id) return

    let toIndex = targetColumn.cardIds.length
    if (over.data.current?.type === 'card') {
      const overIndex = targetColumn.cardIds.indexOf(overId)
      const activeRect = active.rect.current.translated
      const isBelowOverItem = activeRect !== null && activeRect.top > over.rect.top + over.rect.height
      toIndex = overIndex + (isBelowOverItem ? 1 : 0)
    }
    dispatch({ type: 'MOVE_CARD', cardId: activeId, toColumnId: targetColumn.id, toIndex })
  }

  /** 드래그 시작 시점 레이아웃으로 복원 (취소·보드 밖 드롭) */
  function restoreSnapshot() {
    if (dragSnapshot.current) {
      dispatch({ type: 'RESTORE_BOARD_LAYOUT', ...dragSnapshot.current })
      dragSnapshot.current = null
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const wasColumn = active.data.current?.type === 'column'
    setActiveCardId(null)
    setActiveColumnId(null)
    // 보드 밖에서 놓으면(over 없음) 이동 확정이 아니라 취소로 처리
    if (!over) {
      restoreSnapshot()
      return
    }
    dragSnapshot.current = null

    const activeId = String(active.id)
    const overId = String(over.id)

    if (wasColumn) {
      const overColumn = resolveColumn(overId, over.data.current?.type)
      if (!overColumn || overColumn.id === activeId) return
      const toIndex = state.columnOrder.indexOf(overColumn.id)
      dispatch({ type: 'MOVE_COLUMN', columnId: activeId, toIndex })
      return
    }

    // 카드: 컬럼 간 이동은 dragOver에서 이미 반영됐으므로 같은 컬럼 내 순서만 확정
    const sourceColumn = findColumnOfCard(state, activeId)
    const targetColumn = resolveColumn(overId, over.data.current?.type)
    if (!sourceColumn || !targetColumn || sourceColumn.id !== targetColumn.id) return
    if (activeId === overId) return

    const toIndex =
      over.data.current?.type === 'card'
        ? targetColumn.cardIds.indexOf(overId)
        : targetColumn.cardIds.length - 1
    if (toIndex < 0) return
    dispatch({ type: 'MOVE_CARD', cardId: activeId, toColumnId: targetColumn.id, toIndex })
  }

  function handleDragCancel() {
    restoreSnapshot()
    setActiveCardId(null)
    setActiveColumnId(null)
  }

  // 필터링(검색 haystack 생성)은 카드 수에 비례하므로 렌더당 한 번만 계산해
  // 카운트·컬럼 렌더·드래그 오버레이가 같은 결과를 공유한다
  const visibleCardsByColumn = new Map<string, Card[]>()
  for (const columnId of state.columnOrder) {
    const column = state.columns[columnId]
    if (!column) continue
    visibleCardsByColumn.set(
      columnId,
      column.cardIds
        .map((id) => state.cards[id])
        .filter((card): card is Card => card !== undefined)
        .filter((card) => filterExemptIds.includes(card.id) || cardMatchesFilters(card, filters, state.labels)),
    )
  }
  const visibleCardsOf = (column: ColumnType): Card[] => visibleCardsByColumn.get(column.id) ?? []

  const totalVisibleCards = [...visibleCardsByColumn.values()].reduce((sum, cards) => sum + cards.length, 0)
  // 보드에 카드가 있는데 필터가 전부 숨긴 경우에만 — 원래 빈 보드에서는 안내가 거짓이 됨
  const showEmptyFilterState =
    isFilterActive(filters) && totalVisibleCards === 0 && Object.keys(state.cards).length > 0

  const activeCard = activeCardId ? state.cards[activeCardId] : null
  const activeColumn = activeColumnId ? state.columns[activeColumnId] : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            '드래그하려면 Space 키를 누르세요. 화살표 키로 위치를 옮기고, 다시 Space를 눌러 놓거나 Esc로 취소합니다.',
        },
      }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="board" ref={boardRef}>
        <SortableContext items={state.columnOrder} strategy={horizontalListSortingStrategy}>
          {state.columnOrder.map((columnId) => {
            const column = state.columns[columnId]
            if (!column) return null
            return (
              <Column
                key={column.id}
                column={column}
                visibleCards={visibleCardsOf(column)}
                onCardClick={onCardClick}
                onCardAdded={onCardAdded}
              />
            )
          })}
        </SortableContext>
        <AddColumnButton />
        {showEmptyFilterState && (
          <div className="board-empty-filter">
            <SearchX size={28} />
            <p>필터와 일치하는 카드가 없습니다</p>
            <button className="btn btn-primary btn-sm" onClick={onClearFilters}>
              필터 초기화
            </button>
          </div>
        )}
      </div>

      <DragOverlay>
        {activeCard && <CardOverlay card={activeCard} labels={labelsOf(activeCard, state.labels)} />}
        {activeColumn && (
          <section className="column column-overlay">
            <header className="column-header">
              <h2 className="column-title">{activeColumn.title}</h2>
              <span className="column-count">{visibleCardsOf(activeColumn).length}</span>
            </header>
            <div className="column-body">
              {visibleCardsOf(activeColumn).map((card) => (
                <CardOverlay key={card.id} card={card} labels={labelsOf(card, state.labels)} />
              ))}
            </div>
          </section>
        )}
      </DragOverlay>
    </DndContext>
  )
}
